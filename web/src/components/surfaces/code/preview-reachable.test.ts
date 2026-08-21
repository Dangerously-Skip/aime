import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normaliseUrl } from '@/components/shared/preview-panel';

/*
 * THE PREVIEW PANEL COULD NOT BE OPENED BY A HUMAN.
 *
 * `{previewUrl && <PreviewPanel …>}` gates the mount, and the only things that
 * ever set `previewUrl` were the agent writing an HTML file, the agent starting
 * a dev server, or a file-viewer callback. No menu entry, no button, no
 * shortcut.
 *
 * That mattered more than it looks: browser tools are offered to the agent only
 * while this webview is live (`browserToolsAvailable: !!previewWebviewRef
 * .current`). So the most capable agent in the app could drive a browser, and
 * nobody could give it a page to start from.
 *
 * `browser-tools-client.test.ts` asserted Code DECLARES the capability and CAN
 * execute it. Both true, and neither asked whether a human could reach it —
 * the same gap, one layer up, in the tests written to catch that gap.
 */

const src = (...p: string[]) => readFileSync(resolve(__dirname, '../../..', ...p), 'utf8');
const code = src('components/surfaces/code/code-surface.tsx');
const toolbar = src('components/surfaces/code/workspace/panel-toolbar.tsx');
const panel = src('components/shared/preview-panel.tsx');

describe('a user can open the preview', () => {
  it('the Panels menu offers it, and the item actually calls the opener', () => {
    /*
     * Asserted POSITIONALLY, inside the button's own onClick.
     *
     * The first version was `expect(toolbar).toContain('openPreview')`, which is
     * satisfied by the function definition and by a commented-out call —
     * commenting out the call left the test green. Fourth vacuous assertion of
     * this shape today, and the fourth caught by sabotage rather than by review.
     */
    const label = toolbar.indexOf('>Preview<');
    expect(label, 'no Preview item in the Panels menu').toBeGreaterThan(0);

    // The button element wrapping that label.
    const buttonStart = toolbar.lastIndexOf('<button', label);
    const block = toolbar.slice(buttonStart, label);
    expect(block, 'the Preview menu item does not call openPreview()').toMatch(
      /onClick=\{\(\) => \{\s*openPreview\(\);/,
    );
  });

  it('the menu item is wired to an opener the surface provides', () => {
    // A menu entry calling nothing is the same bug with a nicer surface.
    expect(toolbar).toContain('__ideOpenPreview');
    expect(code).toContain('__ideOpenPreview');
  });

  it('the opener sets the gate AND asks the layout to place the panel', () => {
    /*
     * Two halves, two owners: the surface owns `previewUrl` (whether there is
     * anything to render) and the layout owns placement, because it is a
     * dockview panel and only dockview knows where panels go.
     *
     * Anchored on the assignment, not the bare name — the name also appears in
     * prose above it, and matching that would inspect a comment.
     */
    const at = code.indexOf('w.__ideOpenPreview = () => {');
    expect(at, 'surface does not register __ideOpenPreview').toBeGreaterThan(0);
    const opener = code.slice(at, at + 400);
    expect(opener).toContain('setPreviewUrl');
    expect(opener).toContain('setPreviewOpen(true)');
    expect(opener).toContain('__ideOpenPreviewPanel');
  });

  it('does not clobber a URL the agent already set', () => {
    const at = code.indexOf('w.__ideOpenPreview = () => {');
    expect(code.slice(at, at + 400)).toMatch(/current \?\? 'about:blank'/);
  });

  it('is a REAL dockview panel, not an overlay', () => {
    /*
     * The version this replaces rendered outside dockview entirely — a sibling
     * floating over the chat panel, with no tab, so it could not be docked,
     * dragged or placed like every other region. Everything beside it IS a
     * panel, and it looked wrong immediately.
     */
    const layout = src('components/surfaces/code/workspace/workspace-layout.tsx');
    expect(layout).toContain('preview: PreviewRegion');
    expect(layout).toMatch(/component: "preview"/);
    expect(layout).toContain('__ideOpenPreviewPanel');
    /*
       And the surface renders it UNCONDITIONALLY into that slot.

       The two assertions this replaces were `not.toMatch(/\{previewUrl && \(/)`
       and `toContain('previewSlot=')`. The code said `previewUrl ? (`, so the
       negative check missed by one character of syntax, and the positive one was
       satisfied by the very line carrying the bug — the panel was gated on a url
       that only its own address bar could set, so it opened blank and stayed
       blank. Behaviour lives in `preview-panel.empty.test.tsx`; what is checked
       here is the one thing that file cannot see, namely that the surface does
       not re-introduce a gate.
    */
    const slotAt = code.indexOf('previewSlot=');
    expect(slotAt, 'the surface no longer fills the preview slot').toBeGreaterThan(-1);
    const slot = code.slice(slotAt, slotAt + 200);
    expect(slot, 'previewSlot is gated again — a blank panel is the result')
      // `\?(?!\?)` — a ternary, not the `previewUrl ?? ''` default, which is the
      // correct way to pass an absent url through to the panel.
      .not.toMatch(/previewUrl\s*(\?(?!\?)|&&)/);
    expect(slot).toContain('<PreviewPanel');
  });

  it('opening twice focuses rather than duplicating', () => {
    const layout = src('components/surfaces/code/workspace/workspace-layout.tsx');
    const at = layout.indexOf('__ideOpenPreviewPanel');
    const opener = layout.slice(at, at + 700);
    expect(opener).toContain('getPanel');
    expect(opener).toContain('setActive');
  });

  it('survives dockview refusing the placement', () => {
    /*
     * `addPanel` threw `invalid location` on a real run and took the whole Code
     * surface down. A panel in the wrong group is cosmetic; a throw is not.
     */
    const layout = src('components/surfaces/code/workspace/workspace-layout.tsx');
    const at = layout.indexOf('__ideOpenPreviewPanel');
    const opener = layout.slice(at, at + 900);
    expect(opener).toMatch(/try \{/);
    expect(opener).toMatch(/catch/);
  });

  it('is NOT added to PanelSlot, which would reset every saved layout', () => {
    /*
     * `PanelSlot` keys a persisted `Record<PanelSlot, RegionId>` whose migration
     * discards what it does not recognise. The goal panel opens on demand for
     * exactly this reason.
     */
    const slots = /export type PanelSlot =([^;]+);/.exec(src('lib/code-workspace/types.ts'))?.[1];
    expect(slots, 'PanelSlot not found — did it move?').toBeTruthy();
    expect(slots).not.toContain('preview');
  });
});

describe('the address bar is editable', () => {
  it('is an input, not a label', () => {
    /*
       It was a read-only div showing wherever the agent had navigated.

       ASSERTED WITHOUT A DISTANCE BOUND. This read
       `/<input[\s\S]{0,900}aria-label="Preview address"/` — and before that
       {0,400}, which failed against correct markup the first time. Adding one
       handler to the element breaks it again, which is a test failing for a
       reason that has nothing to do with what it is testing.

       The real guarantee — that a user can find and type into the bar — is
       proven by rendering in `preview-panel.empty.test.tsx`, which asks for it
       by its accessible name. What is left here is the structural half: it is an
       input, and it is labelled.
    */
    expect(panel).toContain('<input');
    expect(panel).toContain('aria-label="Preview address"');
    expect(panel).toContain('urlDraft');
  });

  it('keeps the draft separate from the live URL', () => {
    // Bound to `currentUrl` directly, the field is rewritten mid-typing every
    // time the page fires a navigation event.
    expect(panel).toContain('setUrlDraft');
    expect(panel).toMatch(/const \[urlDraft, setUrlDraft\]/);
  });
});

describe('normaliseUrl', () => {
  it('adds https to a bare host rather than searching', () => {
    // A preview address bar is not a search engine.
    expect(normaliseUrl('example.com')).toBe('https://example.com/');
    expect(normaliseUrl('  example.com/path  ')).toBe('https://example.com/path');
  });

  it('keeps an explicit scheme', () => {
    expect(normaliseUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it('REFUSES anything but http(s)', () => {
    /*
     * This webview is handed to an agent. A preview that loads `file://` on
     * request is a way to read the disk through a text box.
     */
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<h1>x']) {
      expect(normaliseUrl(bad), `${bad} should be refused`).toBeNull();
    }
  });

  it('returns null for empty or unparseable input', () => {
    expect(normaliseUrl('')).toBeNull();
    expect(normaliseUrl('   ')).toBeNull();
    expect(normaliseUrl('http://')).toBeNull();
  });
});

describe('the panel actually renders inside a dock', () => {
  const panel = src('components/shared/preview-panel.tsx');

  it('fills its container instead of being a 480px slab', () => {
    /*
     * Written as an overlay docked right of the chat column, it carried its own
     * width, `shrink-0` and a left border. In a dockview panel the panel already
     * has a size, and the border draws a seam where the gutter does the job.
     */
    expect(panel).not.toMatch(/w-\[480px\]/);
    expect(panel).not.toMatch(/shrink-0 w-\[480px\]/);
    expect(panel).toMatch(/h-full min-h-0 w-full/);
  });

  it('does not blank itself when `open` is false', () => {
    /*
     * `if (!open) return null` meant "the overlay is hidden". A dockview panel
     * decides visibility by existing, so that guard could only hide content
     * inside a panel the user had deliberately opened — which is exactly what
     * happened: the tab appeared and the body was empty.
     */
    expect(panel).not.toMatch(/if \(!open\) return null;/);
  });

  it('keeps min-h-0, without which the webview gets no room', () => {
    // A flex child defaults to min-height:auto and refuses to shrink below its
    // content. Same trap as the video stage on the deck.
    expect(panel).toContain('min-h-0');
  });

  it('the duplicate Preview chip is gone from the chat panel', () => {
    // It was the overlay's toggle, anchored where the overlay used to sit. The
    // tab is the control now, and two controls for one thing in two places is
    // worse than either.
    expect(code).not.toMatch(/Preview chip header/);
    expect(code).not.toMatch(/setPreviewOpen\(\(prev\) => !prev\)/);
  });
});
