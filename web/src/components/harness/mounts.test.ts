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
  it('the panel offers a start form when there is no goal', () => {
    /*
     * Before this the panel could report a run and nothing could create one, so
     * the whole feature was unreachable from the UI — a gap that only showed up
     * when a real trial run was attempted.
     */
    const panel = read('components', 'harness', 'goal-panel.tsx');
    expect(panel).toContain('StartGoal');
  });

  it('the start form resolves the route on the CLIENT', () => {
    // A server-resolved model resolves against the built-in Anthropic registry
    // and demands an Anthropic key — dead for an OpenRouter-only user.
    const start = read('components', 'harness', 'start-goal.tsx');
    expect(start).toContain('resolveSendRoute');
    expect(start).toMatch(/model:\s*route\?\.model/);
    expect(start).toMatch(/providerConfig:\s*route\?\.providerConfig/);
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
  it('Cowork offers it in the EMPTY state, not only in the sidebar', () => {
    /*
     * The sidebar does not render when a conversation has no messages — that
     * branch is a separate one entirely. Mounting the start form only there made
     * the feature invisible at the one moment it is wanted: folder chosen,
     * nothing typed. Every test passed; the screenshot found it.
     */
    const cowork = read('components', 'surfaces', 'cowork', 'cowork-surface.tsx');
    expect(cowork).toContain('GoalEntry');
    // It must sit inside the `!hasMessages` branch, before the active-state one.
    const emptyBranch = cowork.slice(
      cowork.indexOf('{!hasMessages ? ('),
      cowork.indexOf('/* ── Active state'),
    );
    expect(emptyBranch).toContain('<GoalEntry');
  });
});
