import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every surface that streams must handle `widget_create`.
 *
 * `WidgetCreate` is mounted on the in-process `aime` MCP server, so it is
 * reachable from every surface — but the handler was only ever added to chat and
 * assistant (commit 9087d8a wired exactly those two). Cowork and code have no
 * `default:` in their chunk switch, so the event fell through in silence while
 * the tool had already told the user "pinned to your Cockpit". That is the
 * user-visible bug: a widget created in chat-like surfaces that could not run.
 *
 * This is a source-level invariant rather than a render test on purpose. The
 * handler is an inline `case` inside a 1900-line component's switch, so there is
 * no seam to call — and the defect is not "does the handler work" (that is
 * `lib/widgets/handle-create-event.test.ts`) or "does the provider emit it"
 * (that is `claude-provider.test.ts`). The defect is one surface out of four
 * being forgotten, which is precisely a cross-file consistency property. The
 * next surface added gets the same reminder.
 */

/**
 * Anchored to THIS file rather than `process.cwd()`, which threw ENOENT instead
 * of failing meaningfully when vitest ran from the repo root.
 */
const SRC_DIR = path.resolve(__dirname, '..');
const SURFACES_DIR = path.join(SRC_DIR, 'surfaces');

/** Surface components that consume the SSE chunk stream. */
const STREAMING_SURFACES = [
  'chat/chat-surface.tsx',
  'cowork/cowork-surface.tsx',
  'code/code-surface.tsx',
  'assistant/assistant-surface.tsx',
];

const read = (rel: string) => fs.readFileSync(path.join(SURFACES_DIR, rel), 'utf8');

/**
 * Every other streaming consumer outside `surfaces/` — the invariant is about
 * chunk handling, not about where the file happens to live, and project-detail
 * runs its own switch.
 */
const OTHER_CONSUMERS = ['projects/project-detail.tsx'];
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');

/**
 * Does the file handle `widget_create` IN ITS CASE ARM?
 *
 * Checking only that both strings appear somewhere in a 1900-line file would
 * pass a copy-paste that put the handler under a different case while
 * `case "widget_create":` fell through empty — the exact silent-fallthrough this
 * guards. So the call has to appear within a few lines of the label.
 */
function handlesWidgetCreateInArm(src: string): boolean {
  // Both dispatch shapes in the codebase: a switch label, and the assistant
  // surface's if/else chain.
  const dispatch = /case\s+["']widget_create["']|event\.type\s*===\s*["']widget_create["']/.exec(src);
  if (!dispatch) return false;
  const arm = src.slice(dispatch.index, dispatch.index + 600);
  return /handleWidgetCreateEvent\s*\(/.test(arm);
}

describe('widget_create wiring', () => {
  it.each(STREAMING_SURFACES)('%s handles the widget_create chunk', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/from ["']@\/lib\/widgets\/handle-create-event["']/);
    expect(handlesWidgetCreateInArm(src), `${rel}: no handler inside the case arm`).toBe(true);
  });

  it.each(OTHER_CONSUMERS)('%s handles it too', (rel) => {
    const src = readSrc(rel);
    expect(src).toMatch(/from ["']@\/lib\/widgets\/handle-create-event["']/);
    expect(handlesWidgetCreateInArm(src), `${rel}: no handler inside the case arm`).toBe(true);
  });

  it('rejects a handler that sits outside the widget_create arm', () => {
    // The guard on the guard: prove the matcher would catch the copy-paste it
    // exists for, rather than any mention of the two names.
    const decoy = `
      case "standing_order_create": { handleWidgetCreateEvent(event); break; }
      case "widget_create": break;
    `;
    expect(handlesWidgetCreateInArm(decoy)).toBe(false);
  });

  it('covers every surface directory that has a *-surface.tsx', () => {
    // Guards the list above from silently going stale when a surface is added.
    const found = fs
      .readdirSync(SURFACES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        fs
          .readdirSync(path.join(SURFACES_DIR, d.name))
          .filter((f) => f.endsWith('-surface.tsx'))
          .map((f) => `${d.name}/${f}`),
      );

    // The browser surface drives its own tool loop and streams nothing the
    // widget tool can ride on; everything else must be in the list.
    const streaming = found.filter((f) => !f.startsWith('browser/'));
    expect(streaming.sort()).toEqual([...STREAMING_SURFACES].sort());
  });
});
