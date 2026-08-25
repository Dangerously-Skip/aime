import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A PRESET MUST LAND SOMEWHERE THE USER IS LOOKING.
 *
 * Reported as "dashboards aren't working". They were working: the buttons live
 * in the ACTIVITY empty state, and since presets became widgets they land in the
 * COCKPIT — so clicking one appeared to do nothing, because the thing you just
 * made is on the other tab.
 *
 * That is the regression I introduced by moving where a feature lands without
 * moving the user with it, and from the outside it is indistinguishable from
 * building something nothing renders. It is the same defect this codebase keeps
 * paying for, committed while fixing an instance of it.
 *
 * Asserted on source rather than by rendering the whole Assistant surface: the
 * surface pulls in the provider store, the SSE stream, the harness and half a
 * dozen schedulers, and a test that heavy would be skipped rather than fixed.
 * What matters is the pair — create AND navigate — and both are visible here.
 */

const src = fs.readFileSync(
  path.join(process.cwd(), 'src/components/surfaces/assistant/assistant-surface.tsx'),
  'utf8',
);

/** The handler the preset buttons call. */
function handler(): string {
  const at = src.indexOf('const addPresetWidget');
  expect(at, 'the preset handler has been renamed or removed').toBeGreaterThan(-1);
  return src.slice(at, at + 600);
}

describe('adding a preset', () => {
  it('creates the widget', () => {
    expect(handler()).toContain('addWidget');
    expect(handler()).toContain('buildPresetWidget');
  });

  it('TAKES THE USER TO IT — the half that was missing', () => {
    /*
     * Without this the widget is created correctly and silently, on a tab the
     * user is not on. "It did nothing" is the only reasonable reading.
     */
    expect(handler(), 'the user is left on Activity looking at nothing').toMatch(
      /setView\(\s*['"]cockpit['"]\s*\)/,
    );
  });

  it('the buttons call the handler rather than adding inline', () => {
    // An inline `addWidget` at the call site would skip the navigation and
    // reintroduce the bug without touching the handler.
    const buttons = src.slice(src.indexOf('Dashboard widgets'), src.indexOf('Dashboard widgets') + 900);
    expect(buttons).toContain('addPresetWidget(preset)');
    expect(buttons, 'a button adds a widget without navigating').not.toMatch(/onClick=\{\(\) => addWidget\(/);
  });
});

describe('where widgets actually render', () => {
  it('the Cockpit renders the widget grid', () => {
    /*
     * The other end of the same claim. If this ever stops being true, the
     * navigation above sends the user somewhere just as empty.
     */
    const cockpit = fs.readFileSync(
      path.join(process.cwd(), 'src/components/surfaces/assistant/cockpit.tsx'),
      'utf8',
    );
    expect(cockpit).toContain('<WidgetGrid');
  });

  it('the widget store is hydrated by something always mounted', () => {
    /*
     * `skipHydration` is set, so an un-hydrated store would let `addWidget`
     * persist `[justThisOne]` over everything saved before — the same
     * write-without-reading-first shape as the standing-order mirror.
     *
     * `useWidgetRefresh` hydrates it and lives on the Assistant surface, which
     * `surface-router` keeps mounted whether or not it is visible.
     */
    expect(src).toContain('useWidgetRefresh()');
    const router = fs.readFileSync(
      path.join(process.cwd(), 'src/components/layout/surface-router.tsx'),
      'utf8',
    );
    expect(router).toMatch(/mounted simultaneously/i);
  });
});
