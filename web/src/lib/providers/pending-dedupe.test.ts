import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { creationKey, recordOnce } from './pending-dedupe';

/**
 * ONE REQUEST, ONE THING.
 *
 * Asked for a daily goals checklist, a single turn produced THREE standing
 * orders and FOUR identical widgets. The trigger was a permission fault — the
 * tools prompted for an approval that never arrived, so the model read each
 * call as failed and tried again — but the reason it COST anything is that both
 * tools appended blindly.
 *
 * Fixing the permission fault removes one cause. It does not remove the others:
 * a resumed leg re-issuing work, a timeout the model did not see complete, or
 * plain uncertainty after an ambiguous result. Any of those still produces a
 * repeat call, and without this the user still pays for it.
 */

describe('creationKey', () => {
  it('treats trivially different spellings as the same request', () => {
    expect(creationKey(['Remind me ', 'cron', '0 9 * * *'])).toBe(
      creationKey(['remind me', 'CRON', '0 9 * * *']),
    );
  });

  it('keeps genuinely different requests apart', () => {
    expect(creationKey(['Remind me', 'cron', '0 9 * * *'])).not.toBe(
      creationKey(['Remind me', 'cron', '0 18 * * *']),
    );
  });

  it('tolerates missing parts without collapsing everything together', () => {
    expect(creationKey(['a', undefined])).not.toBe(creationKey(['b', undefined]));
  });
});

describe('recordOnce', () => {
  it('admits the first and refuses the repeat', () => {
    const seen = new Map<string, true>();
    expect(recordOnce(seen, 'k', true).isNew).toBe(true);
    expect(recordOnce(seen, 'k', true).isNew).toBe(false);
  });

  it('is per-map, so one turn cannot suppress the next', () => {
    // The maps are created per run. A widget made today must not be blocked
    // because an identical one was made yesterday.
    const a = new Map<string, true>();
    const b = new Map<string, true>();
    recordOnce(a, 'k', true);
    expect(recordOnce(b, 'k', true).isNew).toBe(true);
  });
});

describe('the creation tools use it', () => {
  const provider = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/providers/claude-provider.ts'),
    'utf-8',
  );

  /** The handler body for a given tool name. */
  const handler = (name: string) => {
    const i = provider.indexOf(`'${name}'`);
    expect(i, `${name} is gone`).toBeGreaterThan(-1);
    return provider.slice(i, i + 2600);
  };

  it('a standing order is keyed on what makes it distinct', () => {
    const body = handler('StandingOrderCreate');
    expect(body).toContain('recordOnce(seenOrderKeys');
    // Instruction alone would collapse "remind me at 9" and "remind me at 6".
    expect(body).toMatch(/creationKey\(\[input\.instruction, input\.trigger_type, input\.expression\]\)/);
  });

  it('a widget is keyed on title and recipe', () => {
    const body = handler('WidgetCreate');
    expect(body).toContain('recordOnce(seenWidgetKeys');
    expect(body).toMatch(/creationKey\(\[input\.title, input\.recipe\]\)/);
  });

  it('the repeat is TOLD it was a duplicate, not told it succeeded', () => {
    /*
     * The half that actually stops the loop. A model told "created" twice has
     * no reason to change course; it is the honest answer that ends the retry.
     */
    for (const name of ['StandingOrderCreate', 'WidgetCreate']) {
      expect(handler(name), `${name} claims a second was created`).toMatch(
        /not creating a second one/,
      );
    }
  });

  it('the maps are per-run, declared with the pending arrays', () => {
    // Module scope would make them leak across turns and chats, and a widget
    // created today would be silently refused tomorrow.
    expect(provider).toMatch(/const seenOrderKeys = new Map<string, true>\(\);/);
    const declIdx = provider.indexOf('const seenOrderKeys');
    const pendingIdx = provider.indexOf('const pendingStandingOrders');
    expect(Math.abs(declIdx - pendingIdx)).toBeLessThan(700);
  });
});
