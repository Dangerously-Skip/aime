import 'server-only';
import { discoverHome, listCollections, fetchEvents, fetchContacts, type DavResult } from './dav';
import { parseEvents, parseContacts, type CalendarEvent, type Contact } from './parse';
import type { ICloudCredentials } from './config';

/**
 * Calendar and Contacts, above the DAV plumbing.
 *
 * Each call re-runs discovery (principal → home → collections). That is three
 * extra round trips, and it is deliberate for now: the alternative is caching a
 * per-account URL whose invalidation nobody would think about until a user adds
 * a calendar and it fails to appear. When this is hot enough to matter, cache
 * the home URL — it is stable — and leave the collection list uncached.
 */

const err = <T>(r: Extract<DavResult<unknown>, { ok: false }>): DavResult<T> => r;

export interface EventsWindow {
  /** ISO date; defaults to now. */
  from?: string;
  /** ISO date; defaults to 7 days after `from`. */
  to?: string;
  /** Restrict to one calendar by display name; all of them otherwise. */
  calendar?: string;
  limit?: number;
}

const DEFAULT_WINDOW_DAYS = 7;
/** A fortnight of a busy calendar is already more than a turn wants to read. */
export const MAX_EVENTS = 100;

export async function getEvents(
  creds: ICloudCredentials | null,
  opts: EventsWindow = {},
): Promise<DavResult<CalendarEvent[]>> {
  if (!creds) {
    return { ok: false, kind: 'not-configured', message: 'iCloud Calendar is not connected.' };
  }

  const home = await discoverHome(creds, 'caldav');
  if (!home.ok) return err(home);

  const collections = await listCollections(creds, home.value, 'caldav');
  if (!collections.ok) return err(collections);

  const wanted = opts.calendar
    ? collections.value.filter((c) => c.displayName.toLowerCase() === opts.calendar!.toLowerCase())
    : collections.value;

  const from = opts.from ? new Date(opts.from) : new Date();
  const to = opts.to
    ? new Date(opts.to)
    : new Date(from.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);

  const all: CalendarEvent[] = [];
  for (const c of wanted) {
    const res = await fetchEvents(creds, c.url, from, to);
    // One unreadable calendar must not lose the others — a shared calendar the
    // user can see but not REPORT on is a real configuration and would
    // otherwise blank the whole answer.
    if (!res.ok) continue;
    for (const ics of res.value) all.push(...parseEvents(ics));
  }

  all.sort((a, b) => a.start.localeCompare(b.start));
  return { ok: true, value: all.slice(0, Math.min(opts.limit ?? 50, MAX_EVENTS)) };
}

export async function listCalendars(
  creds: ICloudCredentials | null,
): Promise<DavResult<string[]>> {
  if (!creds) {
    return { ok: false, kind: 'not-configured', message: 'iCloud Calendar is not connected.' };
  }
  const home = await discoverHome(creds, 'caldav');
  if (!home.ok) return err(home);
  const collections = await listCollections(creds, home.value, 'caldav');
  if (!collections.ok) return err(collections);
  return { ok: true, value: collections.value.map((c) => c.displayName) };
}

/**
 * Contacts matching a query, searched client-side.
 *
 * CardDAV supports server-side filtering, but iCloud's implementation of it is
 * inconsistent across field types and silently returns nothing rather than an
 * error when it disagrees with the filter — which is the worst possible failure
 * for a lookup. An address book is small enough to fetch and filter here.
 */
export async function searchContacts(
  creds: ICloudCredentials | null,
  query: string,
  limit = 20,
): Promise<DavResult<Contact[]>> {
  if (!creds) {
    return { ok: false, kind: 'not-configured', message: 'iCloud Contacts is not connected.' };
  }

  const home = await discoverHome(creds, 'carddav');
  if (!home.ok) return err(home);
  const books = await listCollections(creds, home.value, 'carddav');
  if (!books.ok) return err(books);

  const needle = query.trim().toLowerCase();
  const out: Contact[] = [];
  for (const b of books.value) {
    const res = await fetchContacts(creds, b.url);
    if (!res.ok) continue;
    for (const vcf of res.value) {
      for (const c of parseContacts(vcf)) {
        if (!needle) {
          out.push(c);
          continue;
        }
        const hay = [c.name, c.org ?? '', ...c.emails, ...c.phones].join(' ').toLowerCase();
        if (hay.includes(needle)) out.push(c);
      }
    }
  }
  return { ok: true, value: out.slice(0, limit) };
}
