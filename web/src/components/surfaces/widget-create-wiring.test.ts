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

const SURFACES_DIR = path.join(process.cwd(), 'src/components/surfaces');

/** Surface components that consume the SSE chunk stream. */
const STREAMING_SURFACES = [
  'chat/chat-surface.tsx',
  'cowork/cowork-surface.tsx',
  'code/code-surface.tsx',
  'assistant/assistant-surface.tsx',
];

const read = (rel: string) => fs.readFileSync(path.join(SURFACES_DIR, rel), 'utf8');

describe('widget_create wiring', () => {
  it.each(STREAMING_SURFACES)('%s handles the widget_create chunk', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/widget_create/);
    // Handling means calling the shared handler — not just naming the string in
    // a comment or a type union.
    expect(src).toMatch(/handleWidgetCreateEvent\s*\(/);
    expect(src).toMatch(/from ["']@\/lib\/widgets\/handle-create-event["']/);
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
