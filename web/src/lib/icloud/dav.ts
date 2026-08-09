import 'server-only';
import { ICLOUD, ICLOUD_TIMEOUT_MS, basicAuthHeader, type ICloudCredentials } from './config';

/**
 * CalDAV and CardDAV against iCloud.
 *
 * Both are HTTP verbs plus XML, so this needs no dependency — `fetch` and a
 * couple of regexes do it. That is a deliberate trade: a full DAV client would
 * handle sync-tokens, ctags and collection discovery properly, and none of that
 * is needed to answer "what is on my calendar this week" or "what is Bob's
 * number". If this grows into two-way sync it should become a real client, and
 * that will be obvious when it happens.
 *
 * ## Discovery, which is the part that surprises people
 *
 * You cannot ask iCloud for "my calendars" at a fixed URL. The sequence is:
 *
 *   1. PROPFIND / for `current-user-principal`   → /1234567890/principal/
 *   2. PROPFIND that for `calendar-home-set`     → /1234567890/calendars/
 *   3. PROPFIND that, depth 1                    → the individual collections
 *
 * Skipping to a guessed path works for one account and fails for the next,
 * because the numeric prefix is per-user.
 */

export type DavFailure = 'auth' | 'network' | 'timeout' | 'not-configured' | 'unexpected';

export type DavResult<T> = { ok: true; value: T } | { ok: false; kind: DavFailure; message: string };

export interface DavOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function propfind(
  url: string,
  creds: ICloudCredentials,
  body: string,
  depth: '0' | '1',
  opts: DavOptions = {},
): Promise<DavResult<string>> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      method: 'PROPFIND',
      signal: AbortSignal.timeout(opts.timeoutMs ?? ICLOUD_TIMEOUT_MS),
      headers: {
        Authorization: basicAuthHeader(creds),
        Depth: depth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body,
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        kind: 'auth',
        message:
          'iCloud rejected the credentials. With two-factor authentication on, this must be an ' +
          'app-specific password from appleid.apple.com, not your Apple ID password.',
      };
    }
    // 207 Multi-Status is the success case for PROPFIND; 200 is tolerated.
    if (res.status !== 207 && res.status !== 200) {
      return { ok: false, kind: 'unexpected', message: `HTTP ${res.status} from ${new URL(url).host}` };
    }
    return { ok: true, value: await res.text() };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, kind: 'timeout', message: 'iCloud did not respond in time.' };
    }
    return { ok: false, kind: 'network', message: e instanceof Error ? e.message : 'Request failed' };
  }
}

/**
 * Pull the text of an element, ignoring namespace prefixes.
 *
 * iCloud uses `d:`, other servers use `D:` or none. Matching on the local name
 * is what makes this survive a server that is equally correct and differently
 * prefixed.
 */
export function davText(xml: string, localName: string): string | null {
  const m = new RegExp(`<[^>]*\\b${localName}\\b[^>]*>([\\s\\S]*?)</[^>]*${localName}>`, 'i').exec(xml);
  return m ? m[1].trim() : null;
}

/** Every `<href>` in a multistatus response, in document order. */
export function davHrefs(xml: string): string[] {
  return [...xml.matchAll(/<[^>]*\bhref\b[^>]*>([\s\S]*?)<\/[^>]*href>/gi)].map((m) => m[1].trim());
}

/** Resolve a possibly-relative DAV href against the server root. */
export function absolute(base: string, href: string): string {
  return href.startsWith('http') ? href : new URL(href, base).toString();
}

const PRINCIPAL_BODY =
  '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';

const HOME_BODY = (ns: string, prop: string) =>
  `<d:propfind xmlns:d="DAV:" xmlns:x="${ns}"><d:prop><x:${prop}/></d:prop></d:propfind>`;

/**
 * Walk principal → home-set for either flavour of DAV.
 *
 * @returns the collection-home URL, e.g. `https://p01-caldav.icloud.com/123/calendars/`.
 */
export async function discoverHome(
  creds: ICloudCredentials,
  kind: 'caldav' | 'carddav',
  opts: DavOptions = {},
): Promise<DavResult<string>> {
  const base = kind === 'caldav' ? ICLOUD.caldav : ICLOUD.carddav;

  const principalRes = await propfind(`${base}/`, creds, PRINCIPAL_BODY, '0', opts);
  if (!principalRes.ok) return principalRes;

  const principalHref = davHrefs(principalRes.value).at(-1);
  if (!principalHref) {
    return { ok: false, kind: 'unexpected', message: 'iCloud returned no principal URL.' };
  }

  const ns = kind === 'caldav' ? 'urn:ietf:params:xml:ns:caldav' : 'urn:ietf:params:xml:ns:carddav';
  const prop = kind === 'caldav' ? 'calendar-home-set' : 'addressbook-home-set';
  const homeRes = await propfind(absolute(base, principalHref), creds, HOME_BODY(ns, prop), '0', opts);
  if (!homeRes.ok) return homeRes;

  // The LAST href is the home-set; the first is the principal echoed back.
  const homeHref = davHrefs(homeRes.value).at(-1);
  if (!homeHref) {
    return { ok: false, kind: 'unexpected', message: `iCloud returned no ${prop}.` };
  }
  return { ok: true, value: absolute(base, homeHref) };
}

export interface Collection {
  url: string;
  displayName: string;
}

const COLLECTIONS_BODY =
  '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>';

/**
 * The individual calendars or address books under a home-set.
 *
 * The home itself comes back in the same response and is filtered out: it has no
 * displayname and is not a leaf collection, so including it would present the
 * user with a phantom calendar that contains everything and nothing.
 */
export async function listCollections(
  creds: ICloudCredentials,
  home: string,
  kind: 'caldav' | 'carddav',
  opts: DavOptions = {},
): Promise<DavResult<Collection[]>> {
  const res = await propfind(home, creds, COLLECTIONS_BODY, '1', opts);
  if (!res.ok) return res;

  const marker = kind === 'caldav' ? 'calendar' : 'addressbook';
  const out: Collection[] = [];
  // Split on <response> so a displayname is attributed to its own href.
  for (const chunk of res.value.split(/<[^>]*\bresponse\b[^>]*>/i).slice(1)) {
    const href = davHrefs(chunk)[0];
    if (!href) continue;
    const isRight = new RegExp(`<[^>]*\\b${marker}\\b[^>]*/>`, 'i').test(chunk);
    if (!isRight) continue;
    const name = davText(chunk, 'displayname');
    if (!name) continue;
    out.push({ url: absolute(home, href), displayName: name });
  }
  return { ok: true, value: out };
}

/** REPORT is how DAV asks for the CONTENTS of a collection, filtered. */
async function report(
  url: string,
  creds: ICloudCredentials,
  body: string,
  opts: DavOptions = {},
): Promise<DavResult<string>> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      method: 'REPORT',
      signal: AbortSignal.timeout(opts.timeoutMs ?? ICLOUD_TIMEOUT_MS),
      headers: {
        Authorization: basicAuthHeader(creds),
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: 'auth', message: 'iCloud rejected the credentials.' };
    }
    if (res.status !== 207 && res.status !== 200) {
      return { ok: false, kind: 'unexpected', message: `HTTP ${res.status}` };
    }
    return { ok: true, value: await res.text() };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, kind: 'timeout', message: 'iCloud did not respond in time.' };
    }
    return { ok: false, kind: 'network', message: e instanceof Error ? e.message : 'Request failed' };
  }
}

/** CalDAV wants its own compact date format, in UTC. */
export function davDate(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Events in a window. A time-range filter is essential rather than a nicety —
 * without it iCloud returns every event ever, which is both slow and far more
 * than a turn can hold.
 */
export async function fetchEvents(
  creds: ICloudCredentials,
  calendarUrl: string,
  from: Date,
  to: Date,
  opts: DavOptions = {},
): Promise<DavResult<string[]>> {
  const body =
    `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">` +
    `<d:prop><c:calendar-data/></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${davDate(from)}" end="${davDate(to)}"/>` +
    `</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;

  const res = await report(calendarUrl, creds, body, opts);
  if (!res.ok) return res;
  return { ok: true, value: extractCalendarData(res.value) };
}

/** The `<calendar-data>` / `<address-data>` payloads out of a multistatus body. */
export function extractCalendarData(xml: string): string[] {
  return [
    ...xml.matchAll(/<[^>]*\b(?:calendar-data|address-data)\b[^>]*>([\s\S]*?)<\/[^>]*(?:calendar-data|address-data)>/gi),
  ].map((m) => decodeXmlEntities(m[1]).trim());
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Ampersand last, or the others get double-decoded.
    .replace(/&amp;/g, '&');
}

/** Every vCard in an address book. */
export async function fetchContacts(
  creds: ICloudCredentials,
  bookUrl: string,
  opts: DavOptions = {},
): Promise<DavResult<string[]>> {
  const body =
    `<c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">` +
    `<d:prop><c:address-data/></d:prop></c:addressbook-query>`;
  const res = await report(bookUrl, creds, body, opts);
  if (!res.ok) return res;
  return { ok: true, value: extractCalendarData(res.value) };
}
