import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  searchMail,
  readMail,
  draftMail,
  extractPlainText,
  formatAddress,
  classifyError,
  MAX_RESULTS,
  MAX_BODY_CHARS,
  type ImapLike,
} from './mail';
import { inspectCredentials, describeCredentialProblem } from './config';

/**
 * iCloud Mail, reached over IMAP because Apple publishes no API for user data.
 *
 * Chosen over AppleScript for one reason that outweighs protocol taste: this app
 * runs standing orders and cron. AppleScript needs Mail.app running on an awake
 * Mac, so "triage my inbox at 8am" is unreliable by construction; IMAP works
 * headlessly, and on Windows and Linux.
 *
 * Tests drive a fake server through the injected factory. Nothing here touches a
 * real mailbox — but the fake is a recording of the protocol, not of our own
 * expectations: it fails the way IMAP fails.
 */

const CREDS = { appleId: 'someone@icloud.com', appPassword: 'abcd-efgh-ijkl-mnop' };

interface FakeOpts {
  uids?: number[];
  messages?: Record<string, unknown>[];
  boxes?: Array<{ path: string; specialUse?: string }>;
  throwOn?: 'connect' | 'search';
  error?: Error;
}

function fakeImap(opts: FakeOpts = {}) {
  const calls = {
    appended: [] as Array<{ path: string; content: string; flags?: string[] }>,
    fetched: [] as unknown[],
    searched: [] as Record<string, unknown>[],
    locked: [] as string[],
    released: 0,
    loggedOut: 0,
  };
  const client: ImapLike = {
    async connect() {
      if (opts.throwOn === 'connect') throw opts.error ?? new Error('boom');
    },
    async logout() {
      calls.loggedOut++;
    },
    async getMailboxLock(p: string) {
      calls.locked.push(p);
      return { release: () => { calls.released++; } };
    },
    async search(q) {
      if (opts.throwOn === 'search') throw opts.error ?? new Error('boom');
      calls.searched.push(q);
      return opts.uids ?? [];
    },
    /*
     * Models a REAL IMAP server: it answers in ascending sequence order
     * whatever order the UID set was written in, and it answers only for the
     * UIDs actually asked for.
     *
     * The previous fake ignored its arguments entirely and yielded a
     * hand-ordered list, so `searchMail`'s `.reverse()` looked like it worked
     * when the server was in fact discarding it — the mock agreed with the code
     * instead of with the protocol, and "what's my latest email?" answered with
     * the oldest.
     */
    async *fetch(range: unknown) {
      const asked = Array.isArray(range) ? range.map(Number) : null;
      calls.fetched.push(asked ?? range);
      const msgs = [...(opts.messages ?? [])]
        .filter((m) => !asked || asked.includes(Number((m as { uid?: unknown }).uid)))
        .sort((a, b) => Number((a as { uid?: unknown }).uid) - Number((b as { uid?: unknown }).uid));
      for (const m of msgs) yield m;
    },
    async append(p, content, flags) {
      calls.appended.push({ path: p, content, flags });
      return {};
    },
    async list() {
      return opts.boxes ?? [{ path: 'INBOX' }, { path: 'Drafts', specialUse: '\\Drafts' }];
    },
  };
  return { factory: () => client, calls };
}

describe('searching the mailbox', () => {
  it('returns the newest matches, newest first', async () => {
    const { factory } = fakeImap({
      uids: [1, 2, 3],
      messages: [
        { uid: 3, envelope: { subject: 'Invoice', from: [{ name: 'Bob', address: 'bob@x.com' }], date: new Date('2026-08-01') }, flags: new Set(['\\Seen']) },
        { uid: 2, envelope: { subject: 'Lunch', from: [{ address: 'ann@x.com' }], date: new Date('2026-07-30') }, flags: new Set() },
      ],
    });
    const r = await searchMail(CREDS, { query: 'invoice' }, factory);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[0].subject).toBe('Invoice');
    expect(r.value[0].from).toBe('Bob <bob@x.com>');
    expect(r.value[0].seen).toBe(true);
    expect(r.value[1].seen).toBe(false);
  });

  it('translates the filters into IMAP criteria', async () => {
    const { factory, calls } = fakeImap({ uids: [1] });
    await searchMail(CREDS, { from: 'bob@x.com', since: '2026-08-01', unseenOnly: true }, factory);
    const q = calls.searched[0];
    expect(q.from).toBe('bob@x.com');
    expect(q.seen).toBe(false);
    expect(q.since).toBeInstanceOf(Date);
  });

  /** An empty criteria object means "match nothing" to some servers; ALL is explicit. */
  it('asks for ALL when no filter is given', async () => {
    const { factory, calls } = fakeImap({ uids: [] });
    await searchMail(CREDS, {}, factory);
    expect(calls.searched[0].all).toBe(true);
  });

  it('caps the result set however many match', async () => {
    const { factory, calls } = fakeImap({ uids: Array.from({ length: 500 }, (_, i) => i) });
    await searchMail(CREDS, { limit: 9999 }, factory);
    expect(MAX_RESULTS).toBeLessThanOrEqual(50);
    expect(calls.locked).toEqual(['INBOX']);
  });

  it('reports an empty mailbox as empty, not as an error', async () => {
    const { factory } = fakeImap({ uids: [] });
    const r = await searchMail(CREDS, { query: 'nothing' }, factory);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });
});

/**
 * The connection must always be closed, including when the operation throws.
 * A leaked lock wedges the next call on the same connection, which presents as
 * "mail worked once and then stopped".
 */
describe('the connection is always cleaned up', () => {
  it('releases the lock and logs out on success', async () => {
    const { factory, calls } = fakeImap({ uids: [] });
    await searchMail(CREDS, {}, factory);
    expect(calls.released).toBe(1);
    expect(calls.loggedOut).toBe(1);
  });

  it('releases the lock and logs out on failure', async () => {
    const { factory, calls } = fakeImap({ throwOn: 'search' });
    const r = await searchMail(CREDS, {}, factory);
    expect(r.ok).toBe(false);
    expect(calls.released, 'the lock leaked on the error path').toBe(1);
    expect(calls.loggedOut).toBe(1);
  });
});

describe('failures the user can act on', () => {
  it('names the app-specific password when auth fails', async () => {
    const { factory } = fakeImap({ throwOn: 'connect', error: new Error('Authentication failed') });
    const r = await searchMail(CREDS, {}, factory);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('auth');
    // The overwhelmingly common cause, invisible from the raw error.
    expect(r.message).toMatch(/app-specific password/i);
  });

  it('separates a timeout from a network failure', () => {
    expect(classifyError(new Error('ETIMEDOUT')).kind).toBe('timeout');
    expect(classifyError(new Error('ECONNREFUSED')).kind).toBe('network');
  });

  it('says so when nothing is connected, without dialling out', async () => {
    const { factory, calls } = fakeImap();
    const r = await searchMail(null, {}, factory);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('not-configured');
    expect(calls.locked, 'it tried to connect anyway').toEqual([]);
  });
});

describe('reading one message', () => {
  const RAW = [
    'From: bob@x.com',
    'Subject: Invoice',
    'Content-Type: multipart/alternative; boundary="XYZ"',
    '',
    '--XYZ',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'The invoice is attached.',
    '--XYZ',
    'Content-Type: text/html',
    '',
    '<html><body>The invoice is attached.</body></html>',
    '--XYZ--',
  ].join('\r\n');

  it('prefers the plain-text part of a multipart message', () => {
    expect(extractPlainText(RAW)).toBe('The invoice is attached.');
    expect(extractPlainText(RAW)).not.toContain('<html>');
  });

  it('drops headers from a simple message', () => {
    expect(extractPlainText('Subject: Hi\r\n\r\nJust the body.')).toBe('Just the body.');
  });

  it('truncates rather than pouring a newsletter into the turn', async () => {
    const huge = `Subject: x\r\n\r\n${'y'.repeat(MAX_BODY_CHARS + 5000)}`;
    const { factory } = fakeImap({
      messages: [{ uid: 1, envelope: { subject: 'x' }, source: Buffer.from(huge) }],
    });
    const r = await readMail(CREDS, 1, 'INBOX', factory);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.body.length).toBe(MAX_BODY_CHARS);
    expect(r.value.truncated).toBe(true);
  });
});

/**
 * The security property of the whole integration, asserted rather than described.
 *
 * This agent reads web pages and search results — untrusted text. An agent that
 * can silently send email turns a prompt injection in a fetched page from "says
 * something wrong" into "mails your contacts". Draft-only keeps a human between
 * the model and the irreversible part, and the guarantee is structural: there is
 * no SMTP client in the module to call.
 */
describe('composing cannot send', () => {
  it('writes to Drafts with the \\Draft flag', async () => {
    const { factory, calls } = fakeImap();
    const r = await draftMail(CREDS, { to: 'bob@x.com', subject: 'Re: Invoice', body: 'Thanks.' }, factory);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mailbox).toBe('Drafts');
    expect(calls.appended[0].flags).toContain('\\Draft');
    expect(calls.appended[0].content).toContain('To: bob@x.com');
    expect(calls.appended[0].content).toContain('Thanks.');
  });

  /** A draft filed somewhere nobody looks is the same as no draft. */
  it('finds Drafts by special-use, not by name', async () => {
    const { factory, calls } = fakeImap({
      boxes: [{ path: 'INBOX' }, { path: 'Brouillons', specialUse: '\\Drafts' }],
    });
    await draftMail(CREDS, { to: 'a@b.c', subject: 's', body: 'b' }, factory);
    expect(calls.appended[0].path).toBe('Brouillons');
  });

  it('has no SMTP client and no send path at all', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'mail.ts'), 'utf-8');
    // Structural, not a promise in a comment: if someone adds sending, this
    // fails and they have to make it a separate, explicitly-enabled tool.
    expect(src, 'an SMTP/send path appeared in the mail module').not.toMatch(
      /nodemailer|createTransport|sendMail|smtp\.mail\.me\.com/i,
    );
  });
});

describe('the credential is checked before it is used', () => {
  it('accepts a real app-specific password', () => {
    expect(inspectCredentials(CREDS)).toBeNull();
  });

  /**
   * The failure worth catching. Against a 2FA account an Apple ID password
   * fails with a bare "authentication failed" and no hint why — one minute to
   * fix if told, an afternoon if discovered.
   */
  it('spots an Apple ID password and explains the difference', () => {
    const p = inspectCredentials({ appleId: 'a@icloud.com', appPassword: 'MyRealPassword1!' });
    expect(p).toBe('looks-like-account-password');
    expect(describeCredentialProblem(p!)).toMatch(/appleid\.apple\.com/);
    expect(describeCredentialProblem(p!)).toMatch(/two-factor/i);
  });

  it.each([
    [{ appleId: '', appPassword: 'abcd-efgh-ijkl-mnop' }, 'missing'],
    [{ appleId: 'notanemail', appPassword: 'abcd-efgh-ijkl-mnop' }, 'not-an-email'],
  ])('rejects %o', (creds, expected) => {
    expect(inspectCredentials(creds)).toBe(expected);
  });
});

describe('addresses', () => {
  it('renders name and address the way a person reads them', () => {
    expect(formatAddress([{ name: 'Bob', address: 'bob@x.com' }])).toBe('Bob <bob@x.com>');
    expect(formatAddress([{ address: 'ann@x.com' }])).toBe('ann@x.com');
    expect(formatAddress([{ address: 'a@x' }, { address: 'b@x' }])).toBe('a@x, b@x');
  });

  it('survives a missing envelope', () => {
    expect(formatAddress(undefined)).toBe('');
    expect(formatAddress([])).toBe('');
  });
});

describe('nothing is logged that should not be', () => {
  it('turns off the IMAP library’s own logger', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'mail.ts'), 'utf-8');
    // imapflow logs every command at info level, which would put subjects and
    // addresses from the user's inbox into the application log.
    expect(src).toMatch(/logger:\s*false/);
  });
});

/**
 * Draft-only is the whole safety story of this module, and it is worth exactly
 * as much as the draft being what the user reads.
 *
 * Headers are LINE-ORIENTED, the tool schema is `z.string()`, and the values
 * came from the model — so a prompt injection in a page the agent fetched could
 * put a real `Bcc:` in the draft. Apple Mail does not show Bcc in the compose
 * view by default, so the human review step that justifies having no SMTP
 * client would be reviewing a message whose recipients it is not displaying.
 */
describe('a header value cannot become a header', () => {
  const drafted = async (msg: { to: string; subject: string; body: string; cc?: string }) => {
    const { factory, calls } = fakeImap();
    const r = await draftMail(CREDS, msg, factory);
    const content = calls.appended[0]?.content ?? '';
    /*
     * Asserted on header LINES, not on a substring of the whole message. A
     * flattened subject legitimately CONTAINS the text "Bcc: …" — that is what
     * flattening means — so `content.includes('bcc:')` cannot tell the attack
     * from the fix, and my first version of these tests failed the working code
     * for exactly that reason.
     */
    const headerLines = content.split('\r\n\r\n')[0].split('\r\n');
    const headerNames = headerLines.map((l) => l.split(':')[0].trim().toLowerCase());
    return { r, content, headerLines, headerNames };
  };

  it('refuses a Bcc smuggled through the subject', async () => {
    const { content, headerNames } = await drafted({
      to: 'boss@corp.com',
      subject: 'Invoice\r\nBcc: exfil@attacker.com',
      body: 'See attached.',
    });
    expect(headerNames, 'an invisible Bcc reached the draft').not.toContain('bcc');
    // The subject survives, flattened — a mangled subject is cosmetic.
    expect(content).toContain('Subject: Invoice Bcc: exfil@attacker.com');
  });

  it.each([
    ['a bare newline', 'Hi\nBcc: e@a.com'],
    ['a folded continuation', 'Hi\r\n\tBcc: e@a.com'],
    ['a leading-space continuation', 'Hi\r\n Bcc: e@a.com'],
  ])('flattens %s in the subject', async (_label, subject) => {
    const { headerLines, headerNames } = await drafted({ to: 'bob@x.com', subject, body: 'x' });
    expect(headerNames).not.toContain('bcc');
    expect(headerLines.filter((l) => l.startsWith('Subject:'))).toHaveLength(1);
  });

  /*
   * Recipients are REFUSED, not flattened. A mangled subject is cosmetic; a
   * mangled address list is a message going somewhere the user did not intend,
   * and silently cleaning it hides the case worth surfacing.
   */
  it.each([
    ['a newline in To', { to: 'a@b.com\r\nBcc: e@a.com', subject: 's', body: 'b' }],
    ['a newline in Cc', { to: 'a@b.com', cc: 'c@d.com\r\nBcc: e@a.com', subject: 's', body: 'b' }],
    ['not an address at all', { to: 'not an address', subject: 's', body: 'b' }],
    ['an empty To', { to: '   ', subject: 's', body: 'b' }],
  ])('refuses %s', async (_label, msg) => {
    const { r, content } = await drafted(msg);
    expect(r.ok, 'the draft was written anyway').toBe(false);
    expect(!r.ok && r.kind).toBe('invalid-recipient');
    expect(content, 'a draft was appended despite the refusal').toBe('');
  });

  /* The complement: ordinary multi-recipient mail must still work. */
  it('accepts a comma-separated recipient list', async () => {
    const { r, content } = await drafted({
      to: 'a@b.com, c@d.com',
      cc: 'e@f.com',
      subject: 'Weekly update',
      body: 'Here it is.',
    });
    expect(r.ok, !r.ok ? r.message : '').toBe(true);
    expect(content).toContain('To: a@b.com, c@d.com');
    expect(content).toContain('Cc: e@f.com');
  });

  /* The BODY may legally contain anything — it is after the header break. */
  it('leaves a body containing header-like text alone', async () => {
    const { r, content, headerNames } = await drafted({
      to: 'a@b.com',
      subject: 'Notes',
      body: 'They wrote:\r\nBcc: someone@else.com\r\nwhich I thought was odd.',
    });
    expect(r.ok).toBe(true);
    expect(headerNames).not.toContain('bcc');
    expect(content.split('\r\n\r\n').slice(1).join('\r\n\r\n')).toContain('Bcc: someone@else.com');
  });
});

/**
 * "What's my latest email?" has to answer with the latest email.
 *
 * `searchMail` did `uids.slice(-limit).reverse()` and passed that array to
 * `fetch()`. IMAP answers in ascending sequence order whatever order the UID
 * set is written in, so the server discarded the reverse and results came back
 * OLDEST first — the model then reported the wrong message as the newest. The
 * old fake ignored its `range` argument and yielded a hand-ordered list, so the
 * test agreed with the code rather than with the protocol.
 */
describe('recency is decided after fetching, not by the request', () => {
  const msg = (uid: number) => ({
    uid,
    envelope: { subject: `m${uid}`, from: [{ address: 'a@b.com' }], date: new Date(2026, 0, uid) },
    flags: new Set<string>(),
  });

  it('returns newest first even though the server answers ascending', async () => {
    const { factory } = fakeImap({ uids: [1, 2, 3, 4], messages: [1, 2, 3, 4].map(msg) });
    const r = await searchMail(CREDS, {}, factory);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((m) => m.uid), 'the oldest message was reported as the newest').toEqual([4, 3, 2, 1]);
  });

  it('keeps the NEWEST when it caps, not the oldest', async () => {
    const { factory } = fakeImap({
      uids: [1, 2, 3, 4, 5],
      messages: [1, 2, 3, 4, 5].map(msg),
    });
    const r = await searchMail(CREDS, { limit: 2 }, factory);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((m) => m.uid)).toEqual([5, 4]);
  });

  it('asks the server only for the messages it capped to', async () => {
    const { factory, calls } = fakeImap({
      uids: [1, 2, 3, 4, 5],
      messages: [1, 2, 3, 4, 5].map(msg),
    });
    await searchMail(CREDS, { limit: 2 }, factory);
    expect(calls.fetched[0]).toEqual([4, 5]);
  });
});

/**
 * A real Apple Mail message, which is not the flat single-boundary shape the
 * original test used.
 *
 * `mixed → alternative → plain + html` is what an ordinary mail with an
 * attachment looks like. Splitting on the OUTER boundary produced one segment
 * containing the whole alternative part, and that segment matched
 * `/content-type:\s*text\/plain/` because the string appears in its BODY — so
 * `MailRead` returned the inner boundary markers and the entire HTML part.
 */
describe('extractPlainText walks the MIME tree it was given', () => {
  const crlf = (s: string) => s.replace(/\n/g, '\r\n');

  it('finds the plain part inside a nested multipart', () => {
    const raw = crlf(`Content-Type: multipart/mixed; boundary="OUTER"

--OUTER
Content-Type: multipart/alternative; boundary="INNER"

--INNER
Content-Type: text/plain; charset=utf-8

The actual message.
--INNER
Content-Type: text/html; charset=utf-8

<p>The actual message.</p>
--INNER--
--OUTER
Content-Type: application/pdf; name="invoice.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--OUTER--
`);
    const text = extractPlainText(raw);
    expect(text).toBe('The actual message.');
    expect(text, 'inner boundary markers leaked into the body').not.toContain('INNER');
    expect(text, 'the HTML alternative was included').not.toContain('<p>');
  });

  it('decodes quoted-printable', () => {
    const raw = crlf(`Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable

Thanks for=E2=80=A6 everything, caf=C3=A9 on me.
`);
    expect(extractPlainText(raw)).toBe('Thanks for… everything, café on me.');
  });

  it('joins a quoted-printable soft line break', () => {
    const raw = crlf(`Content-Type: text/plain
Content-Transfer-Encoding: quoted-printable

This line was wrapped by the =
mail client.
`);
    expect(extractPlainText(raw)).toBe('This line was wrapped by the mail client.');
  });

  it('decodes base64 rather than filling the budget with base64', () => {
    const body = Buffer.from('Hello from a base64 part.', 'utf8').toString('base64');
    const raw = crlf(`Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: base64

${body}
`);
    expect(extractPlainText(raw)).toBe('Hello from a base64 part.');
  });

  it('falls back to de-tagged HTML when there is no plain alternative', () => {
    const raw = crlf(`Content-Type: multipart/alternative; boundary="B"

--B
Content-Type: text/html; charset=utf-8

<div><style>p{color:red}</style><p>Only&nbsp;HTML here.</p></div>
--B--
`);
    const text = extractPlainText(raw);
    expect(text).toContain('Only HTML here.');
    expect(text).not.toContain('<p>');
    expect(text, 'stylesheet text was shown as content').not.toContain('color:red');
  });

  it('still handles a plain single-part message', () => {
    const raw = crlf(`Subject: Hi
Content-Type: text/plain

Just a note.
`);
    expect(extractPlainText(raw)).toBe('Just a note.');
  });

  it('reads a boundary from the section that declares it, not the first in the file', () => {
    // The outer part's BODY mentions a different boundary string; taking the
    // first `boundary=` in the raw text would split on the wrong one.
    const raw = crlf(`Content-Type: multipart/mixed; boundary="REAL"

--REAL
Content-Type: text/plain

A quoted header: boundary="DECOY"
--REAL--
`);
    expect(extractPlainText(raw)).toContain('A quoted header');
  });

  it('does not spin on a malformed message', () => {
    const raw = crlf(`Content-Type: multipart/mixed; boundary="X"

--X
Content-Type: multipart/mixed; boundary="X"

--X
Content-Type: text/plain

deep
`);
    expect(() => extractPlainText(raw)).not.toThrow();
  });
});
