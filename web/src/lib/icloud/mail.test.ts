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
    async *fetch() {
      for (const m of opts.messages ?? []) yield m;
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
