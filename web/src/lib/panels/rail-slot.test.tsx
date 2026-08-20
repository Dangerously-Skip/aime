// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RailSlot } from './rail-slot';

/*
 * This file exists because the assertion it replaces was vacuous.
 *
 * `panel-coverage.test.ts` claimed the registry was "load-bearing, not
 * decoration" by asserting `isPanelAllowed('canvases', 'cowork') === true`.
 * That tests the registry function. It says nothing about whether RailSlot ever
 * CALLS it — and deleting the guard from RailSlot left all 34 tests green.
 *
 * A wrapper that renders its children unconditionally is a comment with angle
 * brackets: the rail would keep working, the registry would silently stop
 * meaning anything, and the drift it exists to prevent would return unobserved.
 *
 * So: render it, and check what comes out.
 */

describe('RailSlot consults the registry', () => {
  it('renders a card the surface is allowed to host', () => {
    render(
      <RailSlot surface="cowork" id="context">
        <p>card body</p>
      </RailSlot>,
    );
    expect(screen.getByText('card body')).toBeTruthy();
  });

  it('renders NOTHING for a panel this surface may not host', () => {
    // `terminal` is a Code panel. On Cowork it must not appear, and this is the
    // assertion that fails if the guard is removed.
    const { container } = render(
      <RailSlot surface="cowork" id="terminal">
        <p>should not appear</p>
      </RailSlot>,
    );
    expect(container.textContent).toBe('');
    expect(screen.queryByText('should not appear')).toBeNull();
  });

  it('renders NOTHING for an id absent from the registry', () => {
    // The drift case: a card added without an entry does not quietly work.
    const { container } = render(
      <RailSlot surface="cowork" id="not-a-panel">
        <p>should not appear</p>
      </RailSlot>,
    );
    expect(container.textContent).toBe('');
  });

  it('is surface-aware rather than globally permissive', () => {
    // The same id, two surfaces, two answers — otherwise `surface` is ignored
    // and every card renders everywhere.
    const cowork = render(
      <RailSlot surface="cowork" id="context">
        <p>ctx</p>
      </RailSlot>,
    );
    expect(cowork.container.textContent).toBe('ctx');

    const code = render(
      <RailSlot surface="code" id="context">
        <p>ctx</p>
      </RailSlot>,
    );
    expect(code.container.textContent).toBe('');
  });
});

describe('RailSlot honours the selected tab', () => {
  /*
   * The rail stacked all seven cards, so three open ones squashed each other
   * and the goal dashboard pushed the rest off-screen. One tab shows at a time
   * now, and this is the prop that decides.
   */
  it('renders the selected panel', () => {
    const { container } = render(
      <RailSlot surface="cowork" id="context" active="context">
        <p>ctx</p>
      </RailSlot>,
    );
    expect(container.textContent).toBe('ctx');
  });

  it('renders nothing for a panel that is not selected', () => {
    const { container } = render(
      <RailSlot surface="cowork" id="context" active="artifacts">
        <p>ctx</p>
      </RailSlot>,
    );
    expect(container.textContent).toBe('');
  });

  it('omitting `active` stacks everything, so a rail without tabs still works', () => {
    // The prop is optional on purpose: a surface that has not adopted tabs
    // should not silently render an empty rail.
    const { container } = render(
      <RailSlot surface="cowork" id="context">
        <p>ctx</p>
      </RailSlot>,
    );
    expect(container.textContent).toBe('ctx');
  });

  it('the registry still wins over the selected tab', () => {
    // Selecting a panel this surface may not host must not smuggle it in.
    const { container } = render(
      <RailSlot surface="cowork" id="terminal" active="terminal">
        <p>nope</p>
      </RailSlot>,
    );
    expect(container.textContent).toBe('');
  });
});
