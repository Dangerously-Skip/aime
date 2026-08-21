import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * EVERY FIELD `WorkspaceContext` DECLARES MUST ACTUALLY BE PUT IN `ctx`.
 *
 * `ctx` is the object stamped onto every dockview panel as its params, and each
 * region reads what it needs out of it. A field can therefore be declared on the
 * interface, read by a region, AND supplied as a prop to this component, while
 * never being copied into `ctx` — at which point the region silently renders
 * nothing. TypeScript cannot catch it, because every such field is optional:
 * `previewSlot?: ReactNode` is satisfied by leaving it out.
 *
 * That is exactly what happened, and it is why three separate fixes to the
 * preview panel all appeared to do nothing:
 *
 *   1. the panel returned null unless `open`
 *   2. it was a 480px overlay rather than a dock panel
 *   3. the surface gated it on `previewUrl ? … : null`
 *   4. THIS — `previewSlot` reached the component and stopped there. The prop
 *      was not even destructured. `ctx.previewSlot` was `undefined` forever, so
 *      the region rendered `null` no matter what the surface passed.
 *
 * A test naming `previewSlot` would only have caught round 4. This one is
 * derived from the interface, so the next optional field to be added and
 * forgotten fails the build without anyone remembering to come back here.
 */

const LAYOUT = path.join(
  process.cwd(),
  'src/components/surfaces/code/workspace/workspace-layout.tsx',
);
const src = fs.readFileSync(LAYOUT, 'utf8');

/** Field names declared on the `WorkspaceContext` interface. */
function declaredFields(): string[] {
  const start = src.indexOf('interface WorkspaceContext');
  expect(start, 'WorkspaceContext interface not found — has it been renamed?').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n}', start));
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
}

/** The `const ctx: WorkspaceContext = { … }` object literal. */
function ctxLiteral(): string {
  const start = src.indexOf('const ctx: WorkspaceContext = {');
  expect(start, 'the ctx literal not found — has it been renamed?').toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\n  };', start));
}

describe('the panel context is fully populated', () => {
  it('declares at least the fields we know about', () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // make every assertion below vacuously true.
    const fields = declaredFields();
    expect(fields.length).toBeGreaterThan(5);
    expect(fields).toContain('previewSlot');
    expect(fields).toContain('slots');
  });

  it.each(declaredFields())('ctx supplies %s', (field) => {
    const literal = ctxLiteral();
    // Shorthand (`previewSlot,`) or explicit (`previewSlot: x`).
    expect(
      new RegExp(`(^|[\\s{,])${field}\\s*[,:]`, 'm').test(literal),
      `WorkspaceContext declares "${field}" but ctx never sets it — any region reading it gets undefined`,
    ).toBe(true);
  });

  it('pushes later changes to panels that already exist', () => {
    /*
     * dockview panels keep the params they were CREATED with, so a value that
     * changes afterwards only reaches them through `updateParameters`. The
     * effect that does this has a hand-written dependency array, so a new
     * ReactNode field can be added to ctx and still never propagate.
     *
     * `previewSlot` is the case that matters: the preview panel is how a user
     * SETS a url, so a panel created before the url arrives is the only kind
     * there is.
     */
    const at = src.indexOf('panel.api.updateParameters(ctx');
    expect(at, 'nothing pushes ctx to existing panels').toBeGreaterThan(-1);
    // Wide enough to clear the effect body — it also pushes baseBranch to diff
    // tabs, and carries the comment explaining why previewSlot is in the list.
    const deps = src.slice(at, at + 1600).match(/\}, \[([^\]]*)\]/);
    expect(deps, 'could not find the effect dependency array').toBeTruthy();
    expect(deps![1]).toContain('previewSlot');
    expect(deps![1]).toContain('slots');
  });
});

describe('the preview region', () => {
  it('renders what ctx gives it, rather than reaching for state itself', () => {
    // Keeps the region dumb: the surface owns the webview's lifecycle and hands
    // its ref to the agent, so only the framing lives here.
    const at = src.indexOf('function PreviewRegion');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 300);
    expect(body).toContain('previewSlot');
  });
});
