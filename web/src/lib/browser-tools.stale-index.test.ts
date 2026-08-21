import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A FAILURE MESSAGE MUST NAME THE WAY FORWARD.
 *
 * Browser tools address elements by an index stamped onto the DOM by the last
 * snapshot (`data-agent-index`). Any navigation or re-render drops those
 * attributes, so an index the model is holding goes stale — which is ordinary,
 * not exceptional, on a real site.
 *
 * The message was `Element not found at index 5`. That is TRUE and useless: it
 * describes the symptom, says nothing about the cause, and offers no next step,
 * so the model reads it as a transient fault and tries again. A real run showed
 * exactly that — four failed clicks in one session.
 *
 * It is the same lesson the loop detector wrote down: "'Denied' alone leaves the
 * model to guess, and a model that guesses after being blocked tends to try the
 * same thing once more. Naming the loop and asking for a different approach is
 * what turns a wall into a signal."
 */

const src = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/browser-tools.ts'),
  'utf8',
);

/** Every "element not found" message the injected scripts can return. */
const missMessages = (): string[] =>
  [...src.matchAll(/'((?:Source |Target )?[Ee]lement not found at index[^']*)'/g)].map((m) => m[1]);

describe('a stale index explains itself', () => {
  it('there are several such messages, and the parser sees them', () => {
    // Guards the regex: matching nothing would make the rest vacuous.
    expect(missMessages().length).toBeGreaterThanOrEqual(4);
  });

  it.each(missMessages())('%s ... names re-snapshotting', (message) => {
    expect(
      /snapshot|get_page_state/i.test(message),
      'the message does not tell the model how to recover',
    ).toBe(true);
  });

  it('the primary message explains WHY the index is gone', () => {
    // Cause, not just symptom — otherwise "not found" reads as bad luck.
    const primary = missMessages().find((m) => m.startsWith('Element not found'))!;
    expect(primary).toMatch(/page has changed/i);
    expect(primary).toMatch(/do not retry this index/i);
  });

  it('still carries the index that failed', () => {
    // The model needs to know WHICH one, and the outer template interpolates it.
    const primary = missMessages().find((m) => m.startsWith('Element not found'))!;
    expect(primary).toContain('${index}');
  });
});
