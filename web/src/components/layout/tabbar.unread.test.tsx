// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Tabbar } from './tabbar';
import { useWidgetStore } from '@/stores/widget-store';
import { useAppStore } from '@/stores/app-store';
import { useContextBusStore } from '@/stores/context-bus-store';
import { renderFingerprint } from '@/lib/widgets/unchanged';
import type { WidgetNode } from '@/lib/widgets/catalog';

/**
 * THE MARK HAS TO BE VISIBLE FROM SOMEWHERE ELSE.
 *
 * A scheduled briefing lands while you are on Code or Browser — that is the
 * entire point of scheduling it. A badge only visible once you are already
 * looking at the Assistant surface tells you nothing you did not know, and the
 * per-tile chip alone is exactly that.
 *
 * Removing the tab-bar wiring produced no typecheck error and broke no test,
 * which is why this file exists.
 */

const node = (value: string): WidgetNode => ({ type: 'metric', label: 'ROI', value });

const widget = (id: string, render: WidgetNode | null, seen?: string) =>
  ({ id, title: id, recipe: 'r', render, seenFingerprint: seen, enabled: true, createdAt: 0 }) as never;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  useWidgetStore.setState({ widgets: [] } as never);
  useContextBusStore.setState({ events: [] } as never);
  // Somewhere OTHER than assistant: an active tab hides its own badge.
  useAppStore.setState({ activeSurface: 'code' } as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The Assistant tab's dot, if it has one. */
const assistantDot = () =>
  screen.getByText('Assistant').closest('button')!.querySelector('span.rounded-full');

describe('unread briefings show on the Assistant tab', () => {
  it('no dot when nothing is unread', () => {
    const seen = renderFingerprint(node('98%'));
    useWidgetStore.setState({ widgets: [widget('w1', node('98%'), seen)] } as never);
    render(<Tabbar />);
    expect(assistantDot()).toBeNull();
  });

  it('a dot when a briefing changed since you looked', () => {
    const seen = renderFingerprint(node('98%'));
    useWidgetStore.setState({ widgets: [widget('w1', node('112%'), seen)] } as never);
    render(<Tabbar />);
    expect(assistantDot(), 'no unread mark on the Assistant tab').not.toBeNull();
  });

  it('a dot for a first render', () => {
    useWidgetStore.setState({ widgets: [widget('w1', node('98%'), undefined)] } as never);
    render(<Tabbar />);
    expect(assistantDot()).not.toBeNull();
  });

  it('no dot for a widget that has never run', () => {
    // "Never ran" is not news; it is a widget waiting for its schedule.
    useWidgetStore.setState({ widgets: [widget('w1', null, undefined)] } as never);
    render(<Tabbar />);
    expect(assistantDot()).toBeNull();
  });

  it('does not put briefings on OTHER surfaces tabs', () => {
    useWidgetStore.setState({ widgets: [widget('w1', node('112%'), undefined)] } as never);
    render(<Tabbar />);
    const browserDot = screen.getByText('Browser').closest('button')!.querySelector('span.rounded-full');
    expect(browserDot).toBeNull();
  });

  it('hides it while you are ON the assistant surface', () => {
    // You are looking at it; the tiles carry the detail from there.
    useAppStore.setState({ activeSurface: 'assistant' } as never);
    useWidgetStore.setState({ widgets: [widget('w1', node('112%'), undefined)] } as never);
    render(<Tabbar />);
    expect(assistantDot()).toBeNull();
  });
});
