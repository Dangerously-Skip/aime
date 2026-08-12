import {
  PublishError,
  checkAudience,
  normaliseRecipients,
  type Audience,
  type PublishInput,
  type PublishResult,
  type PublishTarget,
} from './types';

/**
 * Publish a deck to the user's Google Drive.
 *
 * WHY DRIVE FIRST. The `google-workspace` and `google-personal` connectors
 * already request `https://www.googleapis.com/auth/drive`, so this needs no new
 * credential, no new scope and no infrastructure — the storage the user has
 * already connected. More importantly it is the only tier that can honour
 * "share with these three people": Google enforces that at request time with
 * real accounts, revocation and an audit trail. A bucket cannot, and this
 * module refuses to pretend otherwise (see `checkAudience`).
 *
 * The trade is that named recipients need a Google account. For "anyone with
 * the link" they do not.
 *
 * `fetchImpl` is injected so every path here — including the failures, which
 * are the ones that matter — is testable without a network or a real account.
 */

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
const FILES = 'https://www.googleapis.com/drive/v3/files';

export interface DriveDeps {
  accessToken: string;
  fetchImpl?: typeof fetch;
  /** Shown in errors and in the result summary. */
  label?: string;
}

/** Multipart/related, which is what Drive wants for metadata + content in one call. */
function multipartBody(fileName: string, html: string, boundary: string): string {
  const metadata = JSON.stringify({ name: fileName, mimeType: 'text/html' });
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message || fallback;
  } catch {
    return fallback;
  }
}

function classify(status: number): PublishError['code'] {
  if (status === 401 || status === 403) return 'auth';
  return 'upstream';
}

export function googleDriveTarget(deps: DriveDeps): PublishTarget {
  const doFetch = deps.fetchImpl ?? fetch;
  const label = deps.label ?? 'Google Drive';

  const target: PublishTarget = {
    id: 'google-drive',
    label,
    // Drive has an identity model, so "these people and nobody else" is a
    // promise it can actually keep.
    capabilities: { people: true, revoke: true },

    async publish(input: PublishInput): Promise<PublishResult> {
      checkAudience(target, input.audience);
      if (!deps.accessToken) {
        throw new PublishError(`${label} is not connected. Connect it in Connectors first.`, 'not-connected');
      }

      const boundary = `aime-${Math.abs(hash(input.fileName + input.html.length)).toString(36)}`;
      let created: { id?: string; webViewLink?: string };
      try {
        const res = await doFetch(UPLOAD, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${deps.accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody(input.fileName, input.html, boundary),
        });
        if (!res.ok) {
          throw new PublishError(await readError(res, `Upload failed (${res.status})`), classify(res.status));
        }
        created = (await res.json()) as { id?: string; webViewLink?: string };
      } catch (e) {
        if (e instanceof PublishError) throw e;
        throw new PublishError(e instanceof Error ? e.message : 'Upload failed', 'network');
      }

      const id = created.id;
      if (!id) throw new PublishError('Drive accepted the upload but returned no file id.', 'upstream');

      const effective = await grant(id, input.audience);

      return {
        id,
        url: created.webViewLink ?? `https://drive.google.com/file/d/${id}/view`,
        effective,
        summary:
          effective.kind === 'people'
            ? `Only ${effective.emails.length} named ${effective.emails.length === 1 ? 'person' : 'people'} can open this — they will need to sign in to Google.`
            : 'Anyone with this link can open it. Treat the link itself as the secret.',
      };
    },

    async revoke(id: string): Promise<void> {
      const res = await doFetch(`${FILES}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${deps.accessToken}` },
      });
      // 404 means it is already gone, which is the state the caller wanted.
      if (!res.ok && res.status !== 404) {
        // Keep BOTH: the upstream message alone is often a bare "no", and our
        // context alone hides the reason. The user needs to know which failed
        // and why.
        throw new PublishError(
          `Could not remove the deck: ${await readError(res, `HTTP ${res.status}`)}`,
          classify(res.status),
        );
      }
    },
  };

  /**
   * Grant access, and return what was ACTUALLY granted.
   *
   * A partial failure here is the dangerous case: the file exists, some
   * permissions applied, and reporting success would tell the user their
   * colleague can open something they cannot. So a failed grant throws after
   * the upload — the caller is told the deck is on Drive but unshared, which is
   * recoverable and true.
   */
  async function grant(fileId: string, audience: Audience): Promise<Audience> {
    const permissions =
      audience.kind === 'link'
        ? [{ role: 'reader', type: 'anyone' }]
        : normaliseRecipients(audience.emails)!.map((emailAddress) => ({
            role: 'reader',
            type: 'user',
            emailAddress,
          }));

    for (const permission of permissions) {
      const res = await doFetch(
        `${FILES}/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${deps.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(permission),
        },
      );
      if (!res.ok) {
        const who = 'emailAddress' in permission ? ` for ${permission.emailAddress}` : '';
        throw new PublishError(
          `The deck was uploaded but sharing${who} failed: ${await readError(res, `HTTP ${res.status}`)}. ` +
            `It is in your Drive and currently private.`,
          classify(res.status),
        );
      }
    }

    return audience.kind === 'people'
      ? { kind: 'people', emails: normaliseRecipients(audience.emails)! }
      : { kind: 'link' };
  }

  return target;
}

/** Small deterministic hash — only used to vary a multipart boundary. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
