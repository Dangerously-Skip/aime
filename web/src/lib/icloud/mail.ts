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

export type MailFailure = 'auth' | 'network' | 'timeout' | 'not-configured' | 'no-such-message';

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

      // Newest first, then capped — the tail of a long thread is what matters.
      const wanted = uids.slice(-limit).reverse();

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
      return out;
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
 * Deliberately simple: headers are dropped at the first blank line, and if the
 * message is multipart the first text/plain part wins. A full MIME walk is a
 * library's job, and the failure mode here is "shows a bit of HTML", not
 * "corrupts the mailbox".
 */
export function extractPlainText(raw: string): string {
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(raw)?.[1];
  if (boundary) {
    const parts = raw.split(`--${boundary}`);
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p));
    if (plain) return stripHeaders(plain).trim();
  }
  return stripHeaders(raw).trim();
}

function stripHeaders(section: string): string {
  const idx = section.search(/\r?\n\r?\n/);
  return idx === -1 ? section : section.slice(idx).replace(/^\r?\n\r?\n/, '');
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
        `From: ${creds!.appleId}`,
        `To: ${msg.to}`,
        ...(msg.cc ? [`Cc: ${msg.cc}`] : []),
        `Subject: ${msg.subject}`,
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
