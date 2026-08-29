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
    fireEvent.keyDown(deckRegion(), { key: 'ArrowRight' });
    expect(posted).toContainEqual({ type: 'deck:step', delta: 1 });
  });

  it('ArrowLeft steps back', () => {
    render(<HtmlRenderer {...props} />);
    fireEvent.keyDown(deckRegion(), { key: 'ArrowLeft' });
    expect(posted).toContainEqual({ type: 'deck:step', delta: -1 });
  });

  it('PageDown and Space also advance — the keys presenters actually press', () => {
    render(<HtmlRenderer {...props} />);
    fireEvent.keyDown(deckRegion(), { key: 'PageDown' });
    fireEvent.keyDown(deckRegion(), { key: ' ' });
    expect(posted.filter((m) => m.delta === 1)).toHaveLength(2);
  });

  it('ignores keys it does not own', () => {
    render(<HtmlRenderer {...props} />);
    for (const key of ['a', 'Enter', 'Escape', 'ArrowUp', 'Tab']) {
      fireEvent.keyDown(deckRegion(), { key });
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
