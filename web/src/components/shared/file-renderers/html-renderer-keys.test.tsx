// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HtmlRenderer } from './html-renderer';

/**
 * ARROW KEYS MOVE THE DECK IN THE PANEL.
 *
 * Reported as "arrow keys aren't working on slides in the panel view". The
 * bridge could always do it — `deck:step` dispatches a real keydown inside the
 * frame where `runtime.js` is listening, and the prev/next buttons used it —
 * but nothing in the PARENT ever listened, so the keys worked only in full
 * screen.
 *
 * They cannot be made to work by focusing the iframe: it is sandboxed to an
 * opaque origin on purpose (`allow-scripts` without `allow-same-origin`,
 * because this HTML is model-written from web pages), so its key events belong
 * to a document this app cannot reach. The parent has to listen and forward.
 *
 * Asserted on the POSTED MESSAGE rather than on a rendered slide, because the
 * frame is exactly the thing jsdom cannot execute — and the message is the
 * contract the bridge is written against.
 */

// `looksLikeDeck` needs BOTH a .deck wrapper and .slide sections.
const DECK = `<html><body><div class="deck">
  <section class="slide is-active"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
  <section class="slide"><h1>Three</h1></section>
</div></body></html>`;

let posted: Array<Record<string, unknown>>;

beforeEach(() => {
  posted = [];
  // jsdom has no ResizeObserver; the deck uses one to scale the frame to its box.
  // jsdom reports offsetParent as null for everything, so "is it on screen"
  // would be false for a deck that plainly is. Visible by default here; the
  // hidden case is driven explicitly below.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return document.body;
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Every iframe in this test reports its postMessage calls.
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get() {
      return { postMessage: (msg: Record<string, unknown>) => posted.push(msg) };
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const props = { content: DECK, encoding: 'utf-8', ext: '.html', name: 'deck.html', path: '/tmp/deck.html', onOpenExternal: () => {} };

/**
 * Press a key the way a browser does: at the element that has focus.
 *
 * The first version of these dispatched onto the container while `<body>` was
 * still the active element — a state no browser produces — and that made the
 * container handler and the document handler both fire, which read as a
 * double-step bug that does not exist.
 */
function press(el: HTMLElement, key: string) {
  el.focus();
  fireEvent.keyDown(el, { key });
}

/** The focusable deck region — the panel root. */
function deckRegion(): HTMLElement {
  const frame = document.querySelector('iframe') as HTMLIFrameElement;
  const region = frame.closest('[tabindex]') as HTMLElement | null;
  expect(region, 'the deck panel is not focusable, so it can never receive a key').toBeTruthy();
  return region!;
}

describe('deck keyboard navigation', () => {
  it('ArrowRight steps forward', () => {
    render(<HtmlRenderer {...props} />);
    press(deckRegion(), 'ArrowRight');
    expect(posted).toContainEqual({ type: 'deck:step', delta: 1 });
  });

  it('ArrowLeft steps back', () => {
    render(<HtmlRenderer {...props} />);
    press(deckRegion(), 'ArrowLeft');
    expect(posted).toContainEqual({ type: 'deck:step', delta: -1 });
  });

  it('PageDown and Space also advance — the keys presenters actually press', () => {
    render(<HtmlRenderer {...props} />);
    press(deckRegion(), 'PageDown');
    press(deckRegion(), ' ');
    expect(posted.filter((m) => m.delta === 1)).toHaveLength(2);
  });

  it('ignores keys it does not own', () => {
    render(<HtmlRenderer {...props} />);
    for (const key of ['a', 'Enter', 'Escape', 'ArrowUp', 'Tab']) {
      press(deckRegion(), key);
    }
    expect(posted).toHaveLength(0);
  });

  it('does NOT steal arrows from a text field inside the panel', () => {
    /*
     * The share panel's recipient input lives in this container. A viewer that
     * eats arrow keys while you are typing an email address is a worse bug than
     * the one being fixed.
     */
    render(<HtmlRenderer {...props} />);
    const input = document.createElement('input');
    deckRegion().appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(posted).toHaveLength(0);
  });

  it('takes focus when the slide is clicked', () => {
    // Otherwise the click lands on the iframe, focus goes into a document we
    // cannot see, and the next arrow key reaches nobody.
    render(<HtmlRenderer {...props} />);
    const region = deckRegion();
    fireEvent.mouseDown(document.querySelector('iframe')!);
    expect(document.activeElement).toBe(region);
  });

  it('is not a stop in the tab order', () => {
    // A deck is not a control; putting it in the sequence adds a silent stop.
    render(<HtmlRenderer {...props} />);
    expect(deckRegion().getAttribute('tabindex')).toBe('-1');
  });

  it('the buttons still work — the path that already did', () => {
    render(<HtmlRenderer {...props} />);
    fireEvent.click(screen.getByLabelText('Next slide'));
    expect(posted).toContainEqual({ type: 'deck:step', delta: 1 });
  });
});

describe('the key that arrives with nothing focused', () => {
  /*
   * THE CASE THE FIRST FIX MISSED, and the reason "arrow keys still aren't
   * working" came back. The container handler only fires once you have clicked
   * inside the panel, and clicking the slide puts focus in the frame where
   * runtime.js takes over. Neither covers the ordinary path: open a deck, press
   * the right arrow. Focus is on `<body>`, the event never enters the subtree,
   * and the key reaches nobody.
   *
   * These fire on `document` with `document.activeElement === body`, which is
   * what a real browser does on a fresh panel — and what the previous tests,
   * all of which dispatched onto the container, could never have caught.
   */
  it('advances the deck', () => {
    render(<HtmlRenderer {...props} />);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(posted).toContainEqual({ type: 'deck:step', delta: 1 });
  });

  it('goes back', () => {
    render(<HtmlRenderer {...props} />);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(posted).toContainEqual({ type: 'deck:step', delta: -1 });
  });

  it('STANDS DOWN when anything at all is focused', () => {
    /*
     * The guard that keeps this from being the window-level listener that
     * steals arrows from the file tree and every text field in the app. If
     * something has focus, that component owns the key.
     */
    render(<HtmlRenderer {...props} />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(posted).toHaveLength(0);
    input.remove();
  });

  it('ignores a deck that is not on screen', () => {
    /*
     * Surfaces stay mounted while hidden in this app, so a deck in a background
     * tab would otherwise answer keys meant for whatever is actually visible.
     * jsdom reports `offsetParent` as null for everything, so this asserts the
     * guard EXISTS by driving the visible case through a stub — see the
     * container tests for the behaviour itself.
     */
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(null);
    render(<HtmlRenderer {...props} />);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(posted).toHaveLength(0);
    spy.mockRestore();
  });
});

describe('inside a modal sheet — where it was actually broken', () => {
  /*
   * THE REAL REPORT. The deck opens in a `Sheet`, and a dialog moves focus to
   * its own wrapper when it opens. So `document.activeElement` is the sheet:
   * never `<body>`, so the document listener stood down, and never inside the
   * deck, so the container handler was not in the event path either — the deck
   * is a DESCENDANT of the focused element, and a keydown travels UP from its
   * target, not down.
   *
   * Two fixes in a row missed this because both tests focused either the deck
   * or nothing. "Focus is on something that CONTAINS the deck" is a third
   * shape, and it is the one every dialog produces.
   */
  function renderInSheet() {
    const sheet = document.createElement('div');
    sheet.tabIndex = -1;
    document.body.appendChild(sheet);
    const r = render(<HtmlRenderer {...props} />, { container: sheet });
    sheet.focus();
    return { sheet, ...r };
  }

  it('arrow keys work when the SHEET has focus', () => {
    const { sheet } = renderInSheet();
    expect(document.activeElement).toBe(sheet);
    fireEvent.keyDown(sheet, { key: 'ArrowRight' });
    expect(posted, 'the deck ignored a key while its own dialog had focus').toContainEqual({
      type: 'deck:step',
      delta: 1,
    });
  });

  it('and going back', () => {
    const { sheet } = renderInSheet();
    fireEvent.keyDown(sheet, { key: 'ArrowLeft' });
    expect(posted).toContainEqual({ type: 'deck:step', delta: -1 });
  });

  it('still stands down for a sibling that owns its own arrows', () => {
    /*
     * The guard has to stay meaningful: focus on something that does NOT
     * contain the deck — a file tree, a list, another panel — keeps its keys.
     */
    renderInSheet();
    const other = document.createElement('div');
    other.tabIndex = -1;
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: 'ArrowRight' });
    expect(posted).toHaveLength(0);
    other.remove();
  });

  it('does not double-step when the container already handled it', () => {
    // Both listeners see a key from inside the deck. The container calls
    // preventDefault; the document listener must respect that.
    render(<HtmlRenderer {...props} />);
    press(deckRegion(), 'ArrowRight');
    expect(posted).toHaveLength(1);
  });
});
