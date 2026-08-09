import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  unfold,
  parseLine,
  unescapeText,
  parseDate,
  parseEvents,
  parseContacts,
} from './parse';

/**
 * iCalendar and vCard are older than XML and it shows.
 *
 * Every test here is a shape that a naive `split(':')` parser gets wrong, and
 * each one produces a plausible-looking result rather than an error — which is
 * the dangerous kind. A meeting with a colon in its title silently loses half
 * its name; a folded line silently truncates at 75 characters; an all-day event
 * read as midnight UTC shows up on the wrong day for anyone west of Greenwich.
 */

describe('line folding', () => {
  /**
   * RFC 5545 folds at 75 octets with a leading space on continuation. Unfolding
   * has to happen before anything else or the continuation parses as its own
   * property and the real value is truncated.
   */
  it('rejoins a folded line without leaving the space behind', () => {
    expect(unfold('SUMMARY:Quarterly plan\r\n ning session')).toBe(
      'SUMMARY:Quarterly planning session',
    );
  });

  it('handles a tab continuation as well as a space', () => {
    expect(unfold('SUMMARY:One\r\n\ttwo')).toBe('SUMMARY:Onetwo');
  });

  it('leaves a genuine new property alone', () => {
    expect(unfold('SUMMARY:One\r\nLOCATION:Two')).toBe('SUMMARY:One\r\nLOCATION:Two');
  });
});

describe('splitting a property line', () => {
  it('keeps a colon that belongs to the value', () => {
    // The case that breaks split(':') — and most meetings have one.
    const l = parseLine('SUMMARY:Standup: engineering');
    expect(l?.name).toBe('SUMMARY');
    expect(l?.value).toBe('Standup: engineering');
  });

  it('reads parameters off the name', () => {
    const l = parseLine('DTSTART;TZID=Australia/Sydney:20260812T090000');
    expect(l?.name).toBe('DTSTART');
    expect(l?.params.TZID).toBe('Australia/Sydney');
    expect(l?.value).toBe('20260812T090000');
  });

  /** A quoted parameter may contain a colon; that colon does not end the name. */
  it('ignores a colon inside a quoted parameter', () => {
    const l = parseLine('ATTENDEE;CN="Smith: Bob":mailto:bob@x.com');
    expect(l?.params.CN).toBe('Smith: Bob');
    expect(l?.value).toBe('mailto:bob@x.com');
  });

  it('returns null for a line with no colon at all', () => {
    expect(parseLine('GARBAGE')).toBeNull();
  });
});

describe('text escapes', () => {
  it('decodes the ones the format defines', () => {
    expect(unescapeText('Line one\\nLine two')).toBe('Line one\nLine two');
    expect(unescapeText('Smith\\, Bob')).toBe('Smith, Bob');
    expect(unescapeText('a\\;b')).toBe('a;b');
  });

  /** Backslash last, or an escaped backslash before an n becomes a newline. */
  it('does not turn an escaped backslash into an escape', () => {
    expect(unescapeText('C:\\\\path\\\\n')).toBe('C:\\path\\n');
  });
});

describe('dates', () => {
  it('reads a UTC timestamp', () => {
    expect(parseDate({ name: 'DTSTART', params: {}, value: '20260812T090000Z' })).toEqual({
      iso: '2026-08-12T09:00:00Z',
      allDay: false,
    });
  });

  /**
   * The one that visibly breaks. Read as midnight UTC, an all-day event lands on
   * the previous day for anyone west of Greenwich — a birthday a day early.
   */
  it('keeps an all-day event as a plain date', () => {
    expect(parseDate({ name: 'DTSTART', params: { VALUE: 'DATE' }, value: '20260812' })).toEqual({
      iso: '2026-08-12',
      allDay: true,
    });
    // Recognised by shape too, since not every server sends VALUE=DATE.
    expect(parseDate({ name: 'DTSTART', params: {}, value: '20260812' }).allDay).toBe(true);
  });

  /**
   * A floating time has no Z and belongs to the event's TZID. We carry no
   * timezone database, so it is reported as written rather than converted into a
   * confidently wrong absolute instant.
   */
  it('does not pretend a floating time is UTC', () => {
    const d = parseDate({ name: 'DTSTART', params: { TZID: 'Australia/Sydney' }, value: '20260812T090000' });
    expect(d.iso).toBe('2026-08-12T09:00:00');
    expect(d.iso.endsWith('Z'), 'a floating time was labelled UTC').toBe(false);
  });
});

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc-123
SUMMARY:Standup: engineering
DTSTART;TZID=Australia/Sydney:20260812T090000
DTEND;TZID=Australia/Sydney:20260812T093000
LOCATION:Level 3\\, Room 2
DESCRIPTION:Agenda\\nOne\\nTwo
END:VEVENT
BEGIN:VEVENT
UID:def-456
SUMMARY:Adam's birthday
DTSTART;VALUE=DATE:20260901
END:VEVENT
END:VCALENDAR`;

describe('events', () => {
  it('reads every event in the calendar', () => {
    expect(parseEvents(ICS)).toHaveLength(2);
  });

  it('keeps the whole summary, escapes and all', () => {
    const [e] = parseEvents(ICS);
    expect(e.summary).toBe('Standup: engineering');
    expect(e.location).toBe('Level 3, Room 2');
    expect(e.description).toBe('Agenda\nOne\nTwo');
  });

  it('marks the all-day event as all-day and dates it correctly', () => {
    const [, birthday] = parseEvents(ICS);
    expect(birthday.allDay).toBe(true);
    expect(birthday.start).toBe('2026-09-01');
  });

  /** A missing DTEND means a point in time, not a zero-length event at epoch. */
  it('falls back to the start when there is no end', () => {
    const [, birthday] = parseEvents(ICS);
    expect(birthday.end).toBe(birthday.start);
  });

  it('returns nothing for an empty or malformed calendar', () => {
    expect(parseEvents('')).toEqual([]);
    expect(parseEvents('BEGIN:VEVENT\nEND:VEVENT')).toEqual([]);
  });
});

const VCF = `BEGIN:VCARD
VERSION:3.0
UID:contact-1
FN:Bob Smith
N:Smith;Bob;;;
EMAIL;TYPE=WORK:bob@work.com
EMAIL;TYPE=HOME:bob@home.com
TEL;TYPE=CELL:+61 400 000 000
ORG:Acme Pty Ltd;Engineering
END:VCARD
BEGIN:VCARD
VERSION:3.0
N:Jones;Ann;;;
EMAIL:ann@x.com
END:VCARD`;

describe('contacts', () => {
  it('reads all of them', () => {
    expect(parseContacts(VCF)).toHaveLength(2);
  });

  it('collects every email and phone rather than the first', () => {
    const [bob] = parseContacts(VCF);
    expect(bob.emails).toEqual(['bob@work.com', 'bob@home.com']);
    expect(bob.phones).toEqual(['+61 400 000 000']);
  });

  it('takes the company from the structured ORG field', () => {
    expect(parseContacts(VCF)[0].org).toBe('Acme Pty Ltd');
  });

  /** FN is what the owner chose to see; N is the fallback, in reading order. */
  it('assembles a name from N when FN is absent', () => {
    expect(parseContacts(VCF)[1].name).toBe('Ann Jones');
  });
});

/**
 * The generated inputs are the point: these formats fail on characters people
 * really do put in meeting titles — colons, commas, semicolons, backslashes,
 * newlines — and hand-written cases only cover the ones already thought of.
 */
describe('round-tripping arbitrary text', () => {
  const escape = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

  /**
   * The generator is weighted, not uniform, and that is the whole value of it.
   * Plain `fc.string()` almost never emits a backslash followed by `n` — so it
   * ran 300 times green against an `unescapeText` that turned `C:\\path\\n`
   * into a real newline. A hand-written case caught that bug and the property
   * test did not, which means the generator was testing the wrong alphabet.
   */
  const hostile = fc
    .array(
      fc.oneof(
        { weight: 3, arbitrary: fc.constantFrom('\\', '\n', ',', ';', ':', '"', '=') },
        { weight: 2, arbitrary: fc.string({ minLength: 1, maxLength: 1 }) },
        { weight: 1, arbitrary: fc.constantFrom('n', 'N', 'r', 't') },
      ),
      { minLength: 1, maxLength: 60 },
    )
    .map((cs) => cs.join(''));

  it('any summary survives escaping and parsing', () => {
    fc.assert(
      fc.property(hostile, (summary) => {
        const ics = `BEGIN:VEVENT\nUID:x\nSUMMARY:${escape(summary)}\nDTSTART:20260812T090000Z\nEND:VEVENT`;
        const [e] = parseEvents(ics);
        // A summary of only whitespace/newlines legitimately renders as the
        // placeholder; anything else must come back byte-identical.
        if (!summary.trim()) return true;
        return e !== undefined && e.summary === summary;
      }),
      { numRuns: 300 },
    );
  });

  it('never throws, whatever it is handed', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (junk) => {
        parseEvents(junk);
        parseContacts(junk);
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
