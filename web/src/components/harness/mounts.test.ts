import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The goal panel must be reachable on BOTH surfaces, and must not have been
 * mounted in a way that costs users their layout.
 *
 * Derived from source because the alternative is remembering. A goal run is
 * meaningless on a surface that cannot show it, and the failure is silent — the
 * run works, nobody can see it.
 */
const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), 'src', ...p), 'utf8');

const cowork = read('components', 'surfaces', 'cowork', 'cowork-surface.tsx');
const codeSurface = read('components', 'surfaces', 'code', 'code-surface.tsx');
const layout = read('components', 'surfaces', 'code', 'workspace', 'workspace-layout.tsx');
const slotTypes = read('lib', 'code-workspace', 'types.ts');

describe('the goal panel is mounted on both surfaces', () => {
  it('Cowork renders it', () => {
    expect(cowork).toContain('GoalPanel');
    expect(cowork).toMatch(/surfaceId="cowork"/);
  });

  it('Code registers it as a dockview component', () => {
    expect(layout).toContain('goal: GoalRegion');
    expect(layout).toMatch(/surfaceId="code"/);
  });

  it('both pass the conversation id, since a run is per-conversation', () => {
    // Without this the panel polls for a run keyed on nothing and shows a
    // permanently empty state.
    expect(cowork).toMatch(/conversationId=\{chatId\}/);
    expect(layout).toMatch(/conversationId=\{chatId\}/);
  });
});

describe('a run can actually be started', () => {
  it('the COMPOSER starts a run — there is no second composer', () => {
    /*
     * The start form used to be a whole second box under the chat composer, so
     * doing one thing meant typing the same sentence twice and working out which
     * box was which. Goal mode is a switch on the send now.
     */
    expect(cowork).toContain('GoalModeToggle');
    expect(cowork).toContain('useStartGoal');
    // The one send handler branches on the mode rather than a second one existing.
    expect(cowork).toMatch(/if \(goalMode\)/);
  });

  it('the panel REPORTS, and no longer offers to start', () => {
    const panel = read('components', 'harness', 'goal-panel.tsx');
    expect(panel).not.toContain('StartGoal');
  });

  it('the route is still resolved on the CLIENT', () => {
    // A server-resolved model resolves against the built-in Anthropic registry
    // and demands an Anthropic key — dead for an OpenRouter-only user.
    const hook = read('components', 'harness', 'use-start-goal.ts');
    expect(hook).toContain('resolveSendRoute');
    expect(hook).toMatch(/model:\s*route\?\.model/);
    expect(hook).toMatch(/providerConfig:\s*route\?\.providerConfig/);
  });
});

describe('mounting Code cost nobody their layout', () => {
  it('did NOT add a PanelSlot', () => {
    /*
     * `PanelSlot` feeds `Record<PanelSlot, RegionId>` in the persisted workspace
     * layout, and that store's migrate is `() => ({ byWorkspace: {} })` — it
     * discards everything. Adding a slot would have reset every user's pane
     * arrangement as a side effect of adding a panel.
     */
    const slotLine = /export type PanelSlot =([^;]+);/.exec(slotTypes)?.[1] ?? '';
    expect(slotLine).not.toContain('goal');
  });

  it('opens on demand, the same way file and diff panels do', () => {
    expect(layout).toContain('__ideOpenGoal');
    // The precedent it follows, so this is one pattern rather than two.
    expect(layout).toContain('__ideOpenFile');
  });

  it('the opener is idempotent, so auto-open focuses rather than duplicates', () => {
    const opener = /__ideOpenGoal[\s\S]*?\n {4}\};/.exec(layout)?.[0] ?? '';
    expect(opener).toContain('getPanel');
    expect(opener).toContain('setActive');
  });

  it('something actually opens it, or the panel is unreachable', () => {
    /*
     * A registered component nothing calls is a feature that does not exist.
     * Asserting on the NAME was not enough — the import line alone satisfied it,
     * so deleting the call site left this green. Match the call.
     */
    expect(codeSurface).toMatch(/useGoalAutoOpen\([^)]*chatId[^)]*\)/);
  });
});

describe('the entry point is where the user actually is', () => {
  it('the toggle sits in the composer row of the EMPTY state', () => {
    /*
     * The sidebar does not render when a conversation has no messages, so
     * anything mounted only there is invisible at the one moment it is wanted:
     * folder chosen, nothing typed.
     */
    const emptyBranch = cowork.slice(
      cowork.indexOf('{!hasMessages ? ('),
      cowork.indexOf('/* ── Active state'),
    );
    expect(emptyBranch).toContain('<GoalModeToggle');
  });

  it('shows a run’s status without asking to start another', () => {
    expect(cowork).toContain('GoalRunStatus');
  });
});
