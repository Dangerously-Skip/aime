import { describe, it, expect } from 'vitest';
import { getBrowserConfig } from './browser-config';

/**
 * A CAPABILITY THE MODEL IS NEVER TOLD ABOUT IS NOT A CAPABILITY.
 *
 * Routing this surface through the main chat path gave it subagents: `Agent` and
 * `Skill` are in its tool list, `spawn_agent` is intercepted by the provider and
 * relayed to /api/subagent, and the provider auto-approves them. All of that was
 * true and none of it was in the system prompt, so the model had no reason to
 * reach for one — which is this codebase's recurring shape (wired, correct,
 * unreachable) expressed in prose rather than in code.
 *
 * Breadth is exactly where they earn their place here: browsing is serial, one
 * page in one view, while "price twenty camera models" is twenty independent
 * lookups. That is the reported task.
 */

const prompt = () => {
  const cfg = getBrowserConfig();
  const sp = cfg.systemPrompt;
  return typeof sp === 'string' ? sp : (sp as { append?: string }).append ?? '';
};

describe('the browser prompt', () => {
  it('tells the model it can spawn subagents', () => {
    expect(prompt()).toMatch(/subagent/i);
  });

  it('says WHEN — independent, wide work', () => {
    const p = prompt();
    expect(p).toMatch(/independent/i);
    expect(p).toMatch(/serial|one page at a time/i);
  });

  it('says when NOT to — they cannot see this browser', () => {
    /*
     * The failure mode worth pre-empting: delegating a click. A subagent has no
     * view of this webview and no session, so a browsing step handed to one
     * silently does nothing useful, and the model would have no way to tell.
     */
    const p = prompt();
    expect(p).toMatch(/cannot see the page|no view of this browser/i);
    expect(p).toMatch(/click|login|log in|session/i);
  });

  it('the tools that make it possible are actually granted', () => {
    // Prose is worthless if the tool is not there. Both halves, or neither.
    expect(getBrowserConfig().allowedTools).toEqual(
      expect.arrayContaining(['Agent', 'Skill']),
    );
  });
});
