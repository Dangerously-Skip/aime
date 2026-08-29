import { NextRequest } from 'next/server';
import { inspectCredentials, describeCredentialProblem } from '@/lib/icloud/config';
import { ICLOUD_PROVIDER_ID } from '@/lib/icloud/credentials';
import { getCredentialStore, CredentialStoreUnavailable, CREDENTIAL_STORE_UNAVAILABLE_MESSAGE } from '@/lib/models/credentials';
import { isCrossOriginRequest } from '@/lib/security/same-origin';

export const runtime = 'nodejs';

/**
 * Connect, test and disconnect iCloud.
 *
 * The credential goes into the same encrypted, keychain-backed store the model
 * providers use, so there is no second secret path to get wrong. It is never
 * returned — GET reports only whether one exists.
 *
 * POST verifies BEFORE storing. An app-specific password that iCloud rejects is
 * worse than none: it looks connected, then every tool fails later with an
 * authentication error the user has to trace back here. One IMAP round trip at
 * connect time turns that into an immediate, explicable "no".
 */

function unavailable(err: unknown): Response | null {
  if (err instanceof CredentialStoreUnavailable) {
    return Response.json(
      { error: CREDENTIAL_STORE_UNAVAILABLE_MESSAGE },
      { status: 503 },
    );
  }
  return null;
}

export async function GET() {
  try {
    const rec = await getCredentialStore().get(ICLOUD_PROVIDER_ID);
    return Response.json({
      connected: !!(rec?.appleId && rec?.appPassword),
      // The address is not a secret and is worth showing back, so the user can
      // see WHICH account is connected without re-entering anything.
      appleId: rec?.appleId ?? null,
    });
  } catch (err) {
    return unavailable(err) ?? Response.json({ connected: false, appleId: null });
  }
}

export async function POST(req: NextRequest) {
  /*
   * A credential WRITE, and an IMAP login, from an app that loads untrusted web
   * pages. A `text/plain` POST is CORS-simple — no preflight — and `req.json()`
   * ignores the content type, so without this a page in the browser surface
   * could overwrite the stored Apple ID (silently disconnecting mail, calendar
   * and contacts) and use this endpoint as a login oracle against
   * imap.mail.me.com. CLAUDE.md: "CSRF protection on all state-changing
   * endpoints" — this is one.
   */
  if (isCrossOriginRequest(req)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { appleId?: string; appPassword?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const creds = { appleId: (body.appleId ?? '').trim(), appPassword: (body.appPassword ?? '').trim() };

  const problem = inspectCredentials(creds);
  // `looks-like-account-password` is a WARNING, not a rejection — Apple's format
  // is not guaranteed forever, and refusing a working credential because it
  // fails our regex would be worse than accepting one that fails theirs. So it
  // is only fatal if the login also fails, where it becomes the explanation.
  if (problem && problem !== 'looks-like-account-password') {
    return Response.json({ error: describeCredentialProblem(problem) }, { status: 400 });
  }

  // Verify against the real server before storing anything.
  const { searchMail } = await import('@/lib/icloud/mail');
  const probe = await searchMail(creds, { limit: 1 });
  if (!probe.ok) {
    const hint =
      probe.kind === 'auth' && problem === 'looks-like-account-password'
        ? ` ${describeCredentialProblem(problem)}`
        : '';
    return Response.json({ error: probe.message + hint }, { status: 400 });
  }

  try {
    await getCredentialStore().set(ICLOUD_PROVIDER_ID, creds);
  } catch (err) {
    return unavailable(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
  return Response.json({ ok: true, appleId: creds.appleId });
}

export async function DELETE(req: NextRequest) {
  /*
   * A credential WRITE, and an IMAP login, from an app that loads untrusted web
   * pages. A `text/plain` POST is CORS-simple — no preflight — and `req.json()`
   * ignores the content type, so without this a page in the browser surface
   * could overwrite the stored Apple ID (silently disconnecting mail, calendar
   * and contacts) and use this endpoint as a login oracle against
   * imap.mail.me.com. CLAUDE.md: "CSRF protection on all state-changing
   * endpoints" — this is one.
   */
  if (isCrossOriginRequest(req)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    await getCredentialStore().delete(ICLOUD_PROVIDER_ID);
  } catch (err) {
    return unavailable(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
  return Response.json({ ok: true });
}
