/**
 * Just enough iCalendar and vCard to answer a question.
 *
 * Both formats are older than XML and it shows: fields fold across lines at 75
 * octets, values escape commas and semicolons, and parameters hang off the
 * property name after a colon-or-semicolon that also appears inside values. A
 * naive `split(':')` gets the common case right and then mangles every event
 * with a colon in its summary, which is most meetings.
 *
 * This handles unfolding, parameters and escapes, and stops there. It does not
 * do recurrence expansion (RRULE), timezone databases, or attachments — a
 * recurring event is reported as its base occurrence, which is honest and
 * usually what a person means by "what's on Tuesday". Anything more wants a real
 * library, and the moment it matters that will be plain.
 */

/**
 * Undo RFC 5545 line folding.
 *
 * A continuation is CRLF followed by a single space or tab. Doing this first
 * matters more than it looks: a folded SUMMARY otherwise parses as a property
 * named " and something" and the real summary is truncated at 75 characters.
 */
export function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, '');
}

export interface Line {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Split one unfolded line into name, parameters and value. */
export function parseLine(raw: string): Line | null {
  // The FIRST unquoted colon ends the name-and-parameters section. Quoted
  // parameter values may contain colons, which is why this is not indexOf(':').
  let colon = -1;
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  const [name, ...paramParts] = head.split(';');

  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: unescapeText(value) };
}

/**
 * RFC 5545 text escapes, in one left-to-right pass.
 *
 * Not a chain of `.replace()` calls, and the reason is worth keeping. Given
 * `C:\\path\\n` — an escaped backslash followed by the letter n — a sequential
 * replacer runs its `\n` rule first and matches the SECOND backslash together
 * with the n, producing a real newline where the text said "backslash, n".
 * Reordering does not save it: whichever rule runs first can consume a backslash
 * that belonged to the rule after it. Only a scanner that consumes an escape
 * pair atomically is correct.
 *
 * An unrecognised escape yields the character itself, which is what every
 * tolerant parser does and beats emitting a stray backslash.
 */
export function unescapeText(v: string): string {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== '\\') {
      out += v[i];
      continue;
    }
    const next = v[++i];
    if (next === undefined) {
      // Trailing lone backslash: keep it rather than dropping a character.
      out += '\\';
      break;
    }
    if (next === 'n' || next === 'N') out += '\n';
    else out += next;
  }
  return out;
}

export interface CalendarEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
}

/**
 * Dates arrive in three shapes and conflating them shifts meetings.
 *
 *   20260812T090000Z  UTC
 *   20260812T090000   local to the event's TZID
 *   20260812          all-day, no time at all
 *
 * The all-day case is the one that visibly breaks: read as midnight UTC it
 * lands on the previous day for anyone west of Greenwich, so a birthday shows
 * up a day early. It is returned as a plain date string, unconverted.
 */
export function parseDate(line: Line): { iso: string; allDay: boolean } {
  const v = line.value.trim();
  if (line.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    return { iso: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return { iso: v, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  // Without a Z this is wall-clock time in the event's TZID. We do not carry a
  // timezone database, so it is reported as written rather than converted to a
  // wrong absolute instant — being explicit beats being confidently off by hours.
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`, allDay: false };
}

export function parseEvents(ics: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  let cur: Partial<CalendarEvent> | null = null;

  for (const raw of unfold(ics).split(/\r?\n/)) {
    if (raw === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (raw === 'END:VEVENT') {
      if (cur?.uid && cur.summary !== undefined) {
        out.push({
          uid: cur.uid,
          summary: cur.summary || '(no title)',
          start: cur.start ?? '',
          end: cur.end ?? cur.start ?? '',
          allDay: cur.allDay ?? false,
          ...(cur.location ? { location: cur.location } : {}),
          ...(cur.description ? { description: cur.description } : {}),
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const line = parseLine(raw);
    if (!line) continue;
    switch (line.name) {
      case 'UID': cur.uid = line.value; break;
      case 'SUMMARY': cur.summary = line.value; break;
      case 'LOCATION': cur.location = line.value; break;
      case 'DESCRIPTION': cur.description = line.value; break;
      case 'DTSTART': {
        const d = parseDate(line);
        cur.start = d.iso;
        cur.allDay = d.allDay;
        break;
      }
      case 'DTEND': cur.end = parseDate(line).iso; break;
    }
  }
  return out;
}

export interface Contact {
  uid: string;
  name: string;
  emails: string[];
  phones: string[];
  org?: string;
}

/**
 * vCard's `N` field is five semicolon-separated parts (family;given;middle;
 * prefix;suffix), and `FN` is the display name. Prefer `FN` — it is what the
 * owner chose to see — and fall back to assembling `N` when it is absent.
 */
export function parseContacts(vcf: string): Contact[] {
  const out: Contact[] = [];
  let cur: (Partial<Contact> & { emails: string[]; phones: string[] }) | null = null;

  for (const raw of unfold(vcf).split(/\r?\n/)) {
    if (raw === 'BEGIN:VCARD') {
      cur = { emails: [], phones: [] };
      continue;
    }
    if (raw === 'END:VCARD') {
      if (cur && (cur.name || cur.emails.length)) {
        out.push({
          uid: cur.uid ?? '',
          name: cur.name ?? '(no name)',
          emails: cur.emails,
          phones: cur.phones,
          ...(cur.org ? { org: cur.org } : {}),
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const line = parseLine(raw);
    if (!line) continue;
    switch (line.name) {
      case 'UID': cur.uid = line.value; break;
      case 'FN': cur.name = line.value; break;
      case 'N':
        if (!cur.name) {
          const [family, given] = line.value.split(';');
          cur.name = [given, family].filter(Boolean).join(' ').trim() || undefined;
        }
        break;
      case 'EMAIL': if (line.value) cur.emails.push(line.value); break;
      case 'TEL': if (line.value) cur.phones.push(line.value); break;
      // ORG is structured too: "Company;Department".
      case 'ORG': cur.org = line.value.split(';')[0] || undefined; break;
    }
  }
  return out;
}
