import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pruneEmptyGroups, countEmptyGroups } from './prune-layout';

/**
 * The "phantom panel" in the Code surface.
 *
 * A blank region with no tab and no content, sitting alongside the real panels.
 * It is a dockview GROUP with no panels in it: closing a panel can leave its
 * group behind, `toJSON` persists whatever is there, and `fromJSON` restores it
 * on every launch — so one stray close is permanent until someone finds Reset
 * layout. The Panels menu counts panels, not groups, so it showed three ticks
 * against four visible regions, which is why it reads as a ghost rather than as
 * something the user did.
 *
 * REAL is not invented: it is the layout read out of the reporting profile,
 * with the home directory replaced. Two empty groups, three panels, five groups.
 */
const REAL = {
  grid: {
    root: {
      type: 'branch',
      data: [
        { type: 'leaf', data: { id: '1', views: [] }, size: 200 },
        { type: 'leaf', data: { id: '3', views: [] }, size: 200 },
        { type: 'leaf', data: { id: '5', views: ['chat'] }, size: 400 },
        { type: 'leaf', data: { id: '2', views: ['viewer'] }, size: 400 },
        { type: 'leaf', data: { id: '4', views: ['tree'] }, size: 300 },
      ],
      size: 1500,
    },
  },
  panels: { chat: {}, viewer: {}, tree: {} },
  activeGroup: '5',
};

const groupIds = (layout: unknown): string[] => {
  const out: string[] = [];
  const visit = (n: Record<string, unknown>) => {
    if (n?.type === 'branch') (n.data as Record<string, unknown>[]).forEach(visit);
    else if (n?.data) out.push(String((n.data as { id?: string }).id));
  };
  visit(((layout as { grid: { root: Record<string, unknown> } }).grid.root));
  return out;
};

describe('the reported layout', () => {
  it('has the two empty groups that render as phantoms', () => {
    expect(countEmptyGroups(REAL)).toBe(2);
  });

  it('loses exactly those two and keeps the real panels', () => {
    const { layout, removed } = pruneEmptyGroups(REAL);
    expect(removed).toBe(2);
    expect(groupIds(layout)).toEqual(['5', '2', '4']);
  });

  /** Panels are never invented, reordered or dropped — only empty groups go. */
  it('does not touch the panel definitions', () => {
    const { layout } = pruneEmptyGroups(REAL);
    expect((layout as typeof REAL).panels).toEqual(REAL.panels);
  });

  it('leaves the original object alone', () => {
    const before = JSON.stringify(REAL);
    pruneEmptyGroups(REAL);
    expect(JSON.stringify(REAL)).toBe(before);
  });
});

describe('a layout that is already clean', () => {
  const clean = {
    grid: { root: { type: 'branch', data: [{ type: 'leaf', data: { id: '1', views: ['chat'] } }] } },
  };

  it('is returned unchanged, by identity', () => {
    const { layout, removed } = pruneEmptyGroups(clean);
    expect(removed).toBe(0);
    // Same reference: no needless write, and no chance of a rewrite introducing
    // a difference of its own.
    expect(layout).toBe(clean);
  });
});

describe('nesting', () => {
  /**
   * A branch left with one child is a redundant level — the column cannot be
   * resized because it has nothing to resize against. Collapsing leaves the
   * tree the shape dockview would have built itself.
   */
  it('collapses a branch down to its only surviving child', () => {
    const nested = {
      grid: {
        root: {
          type: 'branch',
          data: [
            {
              type: 'branch',
              data: [
                { type: 'leaf', data: { id: 'a', views: [] } },
                { type: 'leaf', data: { id: 'b', views: ['viewer'] } },
              ],
            },
            { type: 'leaf', data: { id: 'c', views: ['chat'] } },
          ],
        },
      },
    };
    const { layout, removed } = pruneEmptyGroups(nested);
    expect(removed).toBe(1);
    expect(groupIds(layout)).toEqual(['b', 'c']);
    const root = (layout as { grid: { root: { data: { type?: string }[] } } }).grid.root;
    expect(root.data[0].type, 'the redundant branch survived').not.toBe('branch');
  });

  it('finds empty groups at any depth', () => {
    const deep = {
      grid: {
        root: {
          type: 'branch',
          data: [
            { type: 'branch', data: [{ type: 'branch', data: [{ type: 'leaf', data: { id: 'x', views: [] } }] }] },
            { type: 'leaf', data: { id: 'y', views: ['chat'] } },
          ],
        },
      },
    };
    expect(countEmptyGroups(deep)).toBe(1);
    expect(groupIds(pruneEmptyGroups(deep).layout)).toEqual(['y']);
  });
});

/**
 * A wrong repair is worse than a blank panel, so anything unrecognisable is
 * returned untouched rather than guessed at.
 */
describe('it refuses to guess', () => {
  it.each([null, undefined, {}, { grid: {} }, 'nonsense', 42])('passes through %o', (input) => {
    expect(pruneEmptyGroups(input).removed).toBe(0);
    expect(countEmptyGroups(input)).toBe(0);
  });

  /** All groups empty: there is nothing to restore, so say so and let the
   *  caller build the default rather than rendering an empty workspace. */
  it('returns null when nothing would be left', () => {
    const allEmpty = {
      grid: { root: { type: 'branch', data: [{ type: 'leaf', data: { id: '1', views: [] } }] } },
    };
    const { layout, removed } = pruneEmptyGroups(allEmpty);
    expect(removed).toBe(1);
    expect(layout, 'an empty workspace would be restored').toBeNull();
  });
});

/**
 * Both ends, or it does not work. Pruning only on write leaves every existing
 * profile carrying its phantoms forever; only on read means a fresh one gets
 * stored on the next save.
 */
describe('it is applied on both restore and save', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../components/surfaces/code/workspace/workspace-layout.tsx'),
    'utf-8',
  );

  it('prunes what is restored', () => {
    expect(src).toMatch(/pruneEmptyGroups\(layout\.dockviewLayout\)/);
  });

  it('prunes what is saved', () => {
    expect(src).toMatch(/pruneEmptyGroups\(event\.api\.toJSON\(\)[^)]*\)/);
  });
});
