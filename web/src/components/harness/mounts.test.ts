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
  it('Cowork renders it EXACTLY ONCE per state', () => {
    /*
     * It rendered twice at once — main column and sidebar — the same card side
     * by side with itself. The rail is the home: the transcript narrates what
     * happened, and this is the reference view, beside Context and Artifacts.
     */
    expect(cowork).toContain('GoalRunStatus');
    expect(cowork).toMatch(/surfaceId="cowork"/);
    expect(cowork).not.toContain('<GoalPanel');
  });

  it('the ACTIVE state shows it in the rail, and nowhere else', () => {
    const active = cowork.slice(cowork.indexOf('/* ── Active state'));
    // Only the SidebarPanel mount, which lives above the active branch.
    expect((active.match(/<GoalRunStatus/g) ?? []).length).toBe(0);
    const sidebar = cowork.slice(0, cowork.indexOf('{!hasMessages ? ('));
    expect((sidebar.match(/<GoalRunStatus/g) ?? []).length).toBe(1);
  });

  it('the EMPTY state keeps its own, because there is no rail there', () => {
    // The empty branch renders no sidebar at all, so without this a first goal
    // would show nothing while it planned.
    const empty = cowork.slice(cowork.indexOf('{!hasMessages ? ('), cowork.indexOf('/* ── Active state'));
    expect((empty.match(/<GoalRunStatus/g) ?? []).length).toBe(1);
  });

  it('the rail gets the planning state, or a follow-up goal shows nothing', () => {
    expect(cowork).toMatch(/goalStarting=\{/);
    expect(cowork).toMatch(/goalNudge=\{goalNudge\}/);
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

  it('feeds the PLANNING phase through, or the gap is silent again', () => {
    /*
     * Planning is a full model call — thirty seconds or more. Passing
     * `starting` is what puts anything on screen during it; without it the send
     * button goes quiet and the panel appears a minute later, which reads as
     * nothing having happened.
     */
    // In the ACTIVE state this travels via the SidebarPanel prop, so match the
    // call site that builds it rather than the GoalRunStatus mount.
    const mount = /goalStarting=\{[\s\S]{0,300}?\}/.exec(cowork)?.[0] ?? '';
    /*
     * The VALUE, not just the names. Asserting that `goalPhase` appears was
     * satisfied by the surrounding condition alone, so replacing the whole
     * object with `null` left this green.
     */
    expect(mount).toMatch(/objective:\s*goalPending/);
    expect(mount).toMatch(/phase:\s*goalPhase/);
    // And nudged, so the real panel replaces the pending card at once rather
    // than up to 3s later on the next poll.
    expect(cowork).toMatch(/goalNudge=\{goalNudge\}/);
  });
});

describe('a goal run names its chat, and can be followed by another', () => {
  it('titles the conversation from the objective', () => {
    /*
     * A goal run never sends a chat message, so the ordinary titling path never
     * fires and every goal conversation stayed "New Chat" — indistinguishable
     * from every other one in the sidebar.
     */
    // Anchored on the naming block itself — `if (chatId)` appears elsewhere in
    // this file and the first match was a different one entirely.
    const naming = /const untitled[\s\S]{0,400}?\}\)/.exec(cowork)?.[0] ?? '';
    expect(naming).toContain('updateConversation');
    expect(naming).toContain('title:');
    expect(naming).toContain('objective');
  });

  it('only titles an UNTITLED chat, so it never overwrites yours', () => {
    const naming = /const untitled[\s\S]{0,400}?\}\)/.exec(cowork)?.[0] ?? '';
    /*
     * The GUARD, not just the word. Asserting that "untitled" appeared was
     * satisfied by the variable's declaration alone, so replacing the condition
     * with `if (false)` left it green.
     *
     * These are structural checks on source, not behavioural ones — this naming
     * lives inside a 1900-line surface component that no test renders. They
     * catch a deletion; they cannot prove the title reaches the store.
     */
    expect(naming).toMatch(/if \(untitled\)/);
    expect(naming).toMatch(/new chat/i);
  });

  it('the init route allocates a NEW run index rather than one goal per chat', () => {
    const init = read('app', 'api', 'harness', 'init', 'route.ts');
    // The CALL, not the import — importing it and then hardcoding 1 would
    // otherwise pass, and that is exactly one-goal-per-chat again.
    expect(init).toMatch(/runIndex = await nextRunIndex\(/);
    expect(init).toMatch(/harnessDir\([^)]*runIndex\)/);
  });

  it('status and answer operate on the CURRENT run', () => {
    for (const f of [
      read('app', 'api', 'harness', 'route.ts'),
      read('app', 'api', 'harness', 'answer', 'route.ts'),
    ]) {
      expect(f).toContain('currentRunIndex');
    }
  });
});

describe('goal mode reaches every composer', () => {
  const codeComposerSlots = () => codeSurface;

  it('Cowork offers it in BOTH the empty and the active composer', () => {
    /*
     * It was only in the empty state, so a conversation that had already said
     * something — exactly where a follow-up goal starts — could not begin one.
     */
    const empty = cowork.slice(cowork.indexOf('{!hasMessages ? ('), cowork.indexOf('/* ── Active state'));
    const active = cowork.slice(cowork.indexOf('/* ── Active state'));
    expect(empty).toContain('<GoalModeToggle');
    expect(active).toContain('<GoalModeToggle');
    expect(active).toContain('<GoalModeBar');
  });

  it('Code offers it too — it was left out of the first pass entirely', () => {
    // The surface that benefits most: tests are a real gate here, so the
    // verifier has something concrete to run.
    expect(codeComposerSlots()).toContain('GoalModeToggle');
    expect(codeComposerSlots()).toContain('GoalModeBar');
    expect(codeComposerSlots()).toContain('useStartGoal');
    /*
     * And the composer must RENDER the slots, not merely be handed them.
     * Checking the file contained the component name was satisfied by the call
     * site alone, so deleting `{goalToggle}` from the composer body left it
     * green — a toggle passed to a component that never renders it.
     */
    expect(codeSurface).toContain('{goalToggle}');
    expect(codeSurface).toContain('{goalBar}');
  });

  it('Code’s send branches on the mode rather than always chatting', () => {
    expect(codeSurface).toMatch(/if \(goalMode\)/);
    expect(codeSurface).toMatch(/startGoal\(\{/);
  });

  it('Code names its chat from the objective too', () => {
    const naming = /const untitled[\s\S]{0,400}?\}\)/.exec(codeSurface)?.[0] ?? '';
    expect(naming).toMatch(/if \(untitled\)/);
    expect(naming).toContain('title:');
  });
});

describe('the goal panel cannot take the surface down', () => {
  it('addPanel is guarded, because dockview threw "invalid location" on a real run', () => {
    /*
     * `editorRef()` returns a panel it believes exists, and dockview still
     * refused the location — a floating group, or one mid-teardown, is enough.
     * The file and diff openers get away with it because they fire on a tree
     * click, when the editor group is settled; this one fires straight after a
     * send, and the throw took down the whole surface.
     */
    const opener = /__ideOpenGoal[\s\S]*?\n {4}\};/.exec(layout)?.[0] ?? '';
    expect(opener).toContain('try {');
    expect(opener).toContain('catch');
    // And a fallback that asks for no position at all.
    expect(opener).toMatch(/addPanel\(spec\)/);
  });

  it('the caller does not depend on the panel opening either', () => {
    const call = /const open = \(window[\s\S]{0,300}?\}/.exec(codeSurface)?.[0] ?? '';
    expect(call).toContain('typeof open === "function"');
  });

  it('Code shows status under the COMPOSER, not only in the panel', () => {
    // Feedback that a goal has started must not depend on a panel being
    // placeable — that is what left the last run with no indication at all.
    expect(codeSurface).toContain('goalStatus=');
    expect(codeSurface).toContain('GoalRunStatus');
    expect(codeSurface).toContain('{goalStatus}');
  });
});

describe('the run narrates itself into the transcript', () => {
  it('both surfaces subscribe', () => {
    /*
     * A run completed two tasks, changed real code and reported its spend in
     * green — and still read as "I'm not sure it even ran", because all of it
     * happened in a side panel while the transcript showed something else.
     */
    for (const [name, src] of [['cowork', cowork], ['code', codeSurface]] as const) {
      expect(src, `${name} does not narrate`).toContain('useGoalTranscript');
      expect(src).toMatch(/useGoalTranscript\([^)]*addMessage\)/);
    }
  });
});

describe('regressions the review found — UI', () => {
  const startHook = read('components', 'harness', 'use-start-goal.ts');
  const panel = read('components', 'harness', 'goal-panel.tsx');
  const autoopen = read('components', 'harness', 'use-goal-autoopen.ts');
  const transcript = read('components', 'harness', 'use-goal-transcript.ts');
  const route = read('app', 'api', 'harness', 'route.ts');

  it('sends the user’s BYOK key, like every other surface', () => {
    // Without it a Settings-only key user gets "Not logged in · Please run
    // /login" — the same failure 335e0ca fixed one layer down.
    expect(startHook).toContain('anthropicApiKey');
    expect(startHook).toMatch(/apiKey:\s*anthropicApiKey/);
  });

  it('answering RESTARTS the run, not just records the answer', () => {
    // The panel promises "Answer, and it carries on".
    const send = /const send = async[\s\S]*?\n {2}\}/.exec(panel)?.[0] ?? '';
    expect(send).toContain("'/api/harness/answer'");
    expect(send).toMatch(/fetch\('\/api\/harness',\s*\{[\s\S]{0,200}?POST/);
  });

  it('the goal panel can be closed — it is opened once, not every poll', () => {
    expect(autoopen).toContain('opened.current');
  });

  it('transcript keys include the run, so a second goal narrates', () => {
    // Session indexes and task ids restart per run; keys built from them alone
    // collide and every line of run 2 looks already-posted.
    expect(transcript).toMatch(/const run = `r\$\{s\.runIndex/);
    expect(transcript).toMatch(/\$\{run\}:start:/);
  });

  it('the tree guard is not inert outside a git repo', () => {
    // Returning '' on failure made both fingerprints equal, so treeUnchanged was
    // always true and a Bash-armed verifier could fix what it was checking.
    const fp = /async function treeFingerprint[\s\S]*?\n\}/.exec(route)?.[0] ?? '';
    expect(fp).not.toMatch(/catch\s*\{\s*return '';/);
    expect(fp).toContain('stat');
  });

  it('goal mode refuses when there is no conversation yet', () => {
    // The branch returned before the auto-create block, posting an empty id.
    for (const src of [cowork, codeSurface]) {
      expect(src).toMatch(/a goal needs a conversation to live in/);
    }
  });

  it('the active state gets the planning spinner, via the rail', () => {
    /*
     * It rendered only in the empty state, so a follow-up goal — the case the
     * run sequence exists for — showed nothing for the whole planning call. It
     * now reaches the rail's card through goalStarting.
     */
    expect(cowork).toMatch(/goalStarting=\{/);
    expect(cowork).toMatch(/starting=\{goalStarting\}/);
  });
});

describe('resuming a run carries credentials', () => {
  it('the panel sends the resolved route when it restarts the loop', () => {
    /*
     * The resume POST sent only {conversationId, workingDir, surfaceId}, so the
     * restarted sessions had no key, died on "Not logged in", and burned the
     * task's attempts until stuck-task killed the run. Third time this defect
     * has appeared, one layer up each time.
     */
    const panel = read('components', 'harness', 'goal-panel.tsx');
    expect(panel).toContain('useHarnessRoute');
    expect(panel).toMatch(/\.\.\.harnessRoute\(\)/);
  });

  it('start and resume share ONE route builder, so they cannot diverge again', () => {
    const hook = read('components', 'harness', 'use-start-goal.ts');
    expect(hook).toContain('export function useHarnessRoute');
    expect(hook).toMatch(/apiKey:\s*anthropicApiKey/);
  });
});

describe('the question is answerable from the conversation', () => {
  it('both surfaces render it above the composer', () => {
    /*
     * The transcript announced a parked question and pointed at the rail, which
     * is a hop — the user is already at the composer and the thing blocking the
     * run is a sentence away.
     */
    expect(cowork).toContain('<GoalQuestion');
    expect(codeSurface).toContain('<GoalQuestion');
  });

  it('Cowork has it in BOTH composer states', () => {
    const empty = cowork.slice(cowork.indexOf('{!hasMessages ? ('), cowork.indexOf('/* ── Active state'));
    const active = cowork.slice(cowork.indexOf('/* ── Active state'));
    expect(empty).toContain('<GoalQuestion');
    expect(active).toContain('<GoalQuestion');
  });

  it('Code renders the slot, not merely receives it', () => {
    // A control handed to a component that never renders it is the recurring
    // shape of this whole feature's bugs.
    expect(codeSurface).toContain('{goalQuestion}');
  });
});
