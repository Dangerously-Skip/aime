import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PANELS, panelsForSurface, isPanelAllowed, type SurfaceId } from './registry';

/*
 * The registry is a claim. This checks it against the source.
 *
 * `mounts.test.ts` already does this for the goal panel, by hand, and it works
 * — which is exactly the problem: it works because somebody wrote it, and the
 * next panel gets nothing. Every assertion here is derived, so a panel added to
 * the registry is checked without anyone editing this file.
 *
 * Three bugs it exists to make impossible, all from one session:
 *
 *   declared but not mounted -> a working feature nobody can reach
 *   mounted but not declared -> drift; the registry stops being the answer
 *   mounted where not allowed -> `addPanel` throwing `invalid location`
 */

const src = (...p: string[]) => readFileSync(resolve(__dirname, '../..', ...p), 'utf8');

const SURFACE_SOURCE: Record<string, string> = {
  code: src('components/surfaces/code/workspace/workspace-layout.tsx'),
  cowork: src('components/surfaces/cowork/cowork-surface.tsx'),
};

/** The `COMPONENTS` map in workspace-layout — what dockview can actually build. */
function dockComponentKeys(): string[] {
  const block = /const COMPONENTS = \{([\s\S]*?)\} as const;/.exec(SURFACE_SOURCE.code)?.[1] ?? '';
  return [...block.matchAll(/^\s*([a-zA-Z]+):/gm)].map((m) => m[1]);
}

describe('the registry describes reality', () => {
  it('found the sources and the component map', () => {
    // Guards the parser. A regex that silently matches nothing would make every
    // assertion below vacuously true — the exact failure mode this file exists
    // to prevent, so it should not be the failure mode of this file.
    expect(Object.keys(SURFACE_SOURCE).length).toBeGreaterThan(1);
    expect(dockComponentKeys().length).toBeGreaterThanOrEqual(6);
    expect(PANELS.length).toBeGreaterThanOrEqual(9);
  });

  it('every panel id is unique', () => {
    const ids = PANELS.map((p) => p.id);
    expect(new Set(ids).size, `duplicate panel id in the registry: ${ids}`).toBe(ids.length);
  });

  it('every panel declares at least one surface', () => {
    // A panel allowed nowhere is a panel nobody can reach — bug (2) in type form.
    for (const p of PANELS) {
      expect(p.surfaces.length, `${p.id} is allowed on no surface`).toBeGreaterThan(0);
    }
  });
});

describe('DECLARED means MOUNTED — the unreachable-panel bug', () => {
  /*
   * The goal panel was mounted in a branch the empty state never rendered. The
   * feature worked, the tests passed, and the user reported that the option did
   * not exist. A declaration the surface does not honour is worse than no
   * declaration, because it reads as done.
   */
  const cases = PANELS.flatMap((p) =>
    p.surfaces
      .filter((s) => SURFACE_SOURCE[s])
      .map((s) => ({ panel: p, surface: s as SurfaceId })),
  );

  it.each(cases)('$panel.id is actually mounted on $surface', ({ panel, surface }) => {
    expect(
      SURFACE_SOURCE[surface],
      `the registry says ${panel.id} lives on ${surface}, but "${panel.mount}" appears nowhere in that surface`,
    ).toContain(panel.mount);
  });
});

describe('MOUNTED means DECLARED — the drift bug', () => {
  it('every dockview component key has a registry entry', () => {
    /*
     * The other direction. A component registered with dockview but absent here
     * means the registry has quietly stopped being the answer to "what panels
     * exist", which is how it decays into documentation.
     */
    const declared = new Set(PANELS.filter((p) => p.host === 'dock').map((p) => p.mount));
    const undeclared = dockComponentKeys().filter((k) => !declared.has(k));
    expect(undeclared, `dockview builds these but the registry does not list them`).toEqual([]);
  });
});

describe('surface boundaries are enforceable, not advisory', () => {
  it('isPanelAllowed refuses a panel on a surface that does not host it', () => {
    // `addPanel` threw `invalid location` because nothing asked this question
    // first. Now something can.
    expect(isPanelAllowed('terminal', 'code')).toBe(true);
    expect(isPanelAllowed('terminal', 'cowork')).toBe(false);
    expect(isPanelAllowed('context', 'code')).toBe(false);
    expect(isPanelAllowed('nonexistent', 'code')).toBe(false);
  });

  it('the goal panel is allowed on BOTH surfaces', () => {
    // The whole reason the registry exists. A run is meaningless on a surface
    // that cannot show it, and the failure is silent.
    expect(isPanelAllowed('goal', 'code')).toBe(true);
    expect(isPanelAllowed('goal-status', 'cowork')).toBe(true);
  });

  it('Chat and Browser host no panels, deliberately', () => {
    /*
     * DR-20 D-5: composability is a cost and earns its place only where regions
     * compete. Chat is one calm column; Browser wants a viewport. If a panel
     * ever claims either, that should be a decision someone makes on purpose
     * and this test is where they will notice they are making it.
     */
    expect(panelsForSurface('chat')).toEqual([]);
    expect(panelsForSurface('browser')).toEqual([]);
  });
});

describe('the goal panel stays out of PanelSlot', () => {
  it('is not a static slot, because that would reset every saved layout', () => {
    /*
     * Kept from mounts.test.ts because it is a fact about persisted user data,
     * not about this refactor: `PanelSlot` is the key type of a persisted
     * `Record<PanelSlot, RegionId>` whose migration discards anything it does
     * not recognise. Adding `goal` to it costs every user their workspace.
     */
    const slots = /export type PanelSlot =([^;]+);/.exec(src('lib/code-workspace/types.ts'))?.[1];
    expect(slots, 'PanelSlot type not found — did it move?').toBeTruthy();
    expect(slots).not.toContain('goal');
  });
});
