import { describe, it, expect } from 'vitest';
import { getEvents } from './calendar';

const CREDS = { appleId: 'someone@icloud.com', appPassword: 'abcd-efgh-ijkl-mnop' };

/**
 * An unreadable date has to come back as a RESULT.
 *
 * `from`/`to` went straight to `new Date()` and then to `davDate`, which calls
 * `.toISOString()` — and that throws `RangeError: Invalid time value` on an
 * Invalid Date. The tool schema says "ISO date", so `CalendarEvents({ from:
 * "tomorrow" })` is an ordinary model mistake, and it escaped the `DavResult`
 * contract entirely: discovery succeeded, then the first fetch threw out of
 * `getEvents` and out of the MCP tool handler, instead of returning something
 * the model could read and correct.
 *
 * These need no network: the check runs before any request is made, which is
 * the point — a bad argument should not cost a round trip either.
 */
describe('a date it cannot read is a result, not a throw', () => {
  it.each(['tomorrow', 'next week', 'not a date', 'yesterday'])(
    'refuses from=%p without throwing',
    async (from) => {
      const r = await getEvents(CREDS, { from });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.message).toMatch(/not a date I can read/i);
      expect(r.message, 'the model is not told what a good value looks like').toMatch(/ISO date/i);
    },
  );

  it('refuses an unreadable `to` as well', async () => {
    const r = await getEvents(CREDS, { from: '2026-08-01', to: 'whenever' });
    expect(r.ok).toBe(false);
  });

  it('names which field was wrong', async () => {
    const r = await getEvents(CREDS, { from: '2026-08-01', to: 'whenever' });
    expect(!r.ok && r.message).toContain('`to`');
  });

  it('does not throw for any of them', async () => {
    for (const from of ['tomorrow', '', '13/45/2026', 'Z']) {
      await expect(getEvents(CREDS, { from })).resolves.toBeDefined();
    }
  });

  /*
   * The complement. An ISO date must still get through to discovery — a guard
   * that rejected valid input would be worse than the crash it replaced.
   * Without credentials this returns not-configured; with them it proceeds past
   * the date check, which is all this asserts.
   */
  it('lets a real ISO date past the check', async () => {
    const r = await getEvents(null, { from: '2026-08-01', to: '2026-08-08' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.kind, 'a valid date was rejected as unreadable').toBe('not-configured');
  });
});
