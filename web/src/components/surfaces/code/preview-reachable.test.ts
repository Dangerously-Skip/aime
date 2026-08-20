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

  it('the opener sets the gate that mounts the panel', () => {
    /*
     * `previewUrl` is the mount condition. An opener that only flipped
     * `previewOpen` would toggle a boolean nothing reads.
     */
    const opener = code.slice(code.indexOf('__ideOpenPreview'), code.indexOf('__ideOpenPreview') + 400);
    expect(opener).toContain('setPreviewUrl');
    expect(opener).toContain('setPreviewOpen(true)');
  });

  it('does not clobber a URL the agent already set', () => {
    // Opening the panel while a dev server preview is showing should focus it,
    // not navigate away from what the agent just built.
    const opener = code.slice(code.indexOf('__ideOpenPreview'), code.indexOf('__ideOpenPreview') + 400);
    expect(opener).toMatch(/current \?\? 'about:blank'/);
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
    // It was a read-only div showing wherever the agent had navigated.
    // The bound is generous on purpose: the handlers between `<input` and the
    // aria-label are long, and the first version capped it at 400 characters and
    // failed against correct markup.
    expect(panel).toMatch(/<input[\s\S]{0,900}aria-label="Preview address"/);
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
