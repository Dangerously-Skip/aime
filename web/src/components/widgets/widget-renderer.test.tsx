// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { WidgetRenderer } from './widget-renderer';
import { parseWidget, type WidgetNode } from '@/lib/widgets/catalog';
import { WIDGET_ACTIONS } from '@/lib/widgets/actions';

afterEach(cleanup);

/** Render through the coercer, exactly as the app does. */
function renderWidget(raw: unknown, onAction?: (a: never) => void) {
  const node = parseWidget(raw);
  return render(<WidgetRenderer node={node} onAction={onAction as never} />);
}

describe('WidgetRenderer — primitives', () => {
  it('renders nothing for a null node', () => {
    const { container } = render(<WidgetRenderer node={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders text, metric and badge', () => {
    renderWidget({ type: 'text', text: 'Build summary', variant: 'heading' });
    expect(screen.getByText('Build summary')).toBeTruthy();

    cleanup();
    renderWidget({ type: 'metric', label: 'Spend', value: '$4.10', delta: '+12%', state: 'up' });
    expect(screen.getByText('Spend')).toBeTruthy();
    expect(screen.getByText('$4.10')).toBeTruthy();
    expect(screen.getByText('+12%')).toBeTruthy();

    cleanup();
    renderWidget({ type: 'badge', text: 'passing', tone: 'success' });
    expect(screen.getByText('passing')).toBeTruthy();
  });

  it('renders a table with normalised rows', () => {
    renderWidget({ type: 'table', columns: ['Job', 'Status'], rows: [['build', 'ok'], ['test']] });
    expect(screen.getByText('Job')).toBeTruthy();
    expect(screen.getByText('build')).toBeTruthy();
    expect(screen.getByText('test')).toBeTruthy();
  });

  it('renders list, keyValue, timeline and progress', () => {
    renderWidget({ type: 'list', items: [{ text: 'first', sub: 'detail', badge: 'new' }] });
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('detail')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();

    cleanup();
    renderWidget({ type: 'keyValue', rows: [{ key: 'Region', value: 'ap-southeast-2' }] });
    expect(screen.getByText('ap-southeast-2')).toBeTruthy();

    cleanup();
    renderWidget({ type: 'timeline', items: [{ time: '09:00', title: 'deploy', sub: 'v1.2' }] });
    expect(screen.getByText('deploy')).toBeTruthy();

    cleanup();
    renderWidget({ type: 'progress', value: 42, label: 'Coverage' });
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
  });

  it('recurses through section and card containers', () => {
    renderWidget({
      type: 'card',
      title: 'Overnight',
      subtitle: 'last 12h',
      children: [
        { type: 'section', title: 'Failures', children: [{ type: 'text', text: 'none' }] },
        { type: 'divider' },
      ],
    });
    expect(screen.getByText('Overnight')).toBeTruthy();
    expect(screen.getByText('Failures')).toBeTruthy();
    expect(screen.getByText('none')).toBeTruthy();
  });
});

describe('WidgetRenderer — charts', () => {
  it('renders each chart kind without a charting dependency', () => {
    for (const chart of ['bar', 'line', 'area', 'pie'] as const) {
      cleanup();
      renderWidget({
        type: 'chart',
        chart,
        title: `${chart} chart`,
        points: [
          { label: 'mon', value: 3 },
          { label: 'tue', value: 7 },
        ],
      });
      expect(screen.getByText(`${chart} chart`), chart).toBeTruthy();
      expect(document.querySelector('svg'), chart).toBeTruthy();
    }
  });

  it('handles a single-point chart without producing NaN geometry', () => {
    renderWidget({ type: 'chart', chart: 'line', points: [{ label: 'only', value: 5 }] });
    const svg = document.querySelector('svg')!;
    expect(svg.innerHTML).not.toContain('NaN');
  });

  it('handles an all-zero pie rather than drawing broken arcs', () => {
    renderWidget({ type: 'chart', chart: 'pie', points: [{ label: 'a', value: 0 }] });
    expect(screen.getByText(/No data to chart/i)).toBeTruthy();
  });

  it('renders a whole-circle pie as a circle, not a zero-length arc', () => {
    renderWidget({ type: 'chart', chart: 'pie', points: [{ label: 'all', value: 10 }] });
    expect(document.querySelector('circle')).toBeTruthy();
    expect(document.querySelector('svg')!.innerHTML).not.toContain('NaN');
  });
});

describe('WidgetRenderer — actions', () => {
  it('dispatches a known action', () => {
    const onAction = vi.fn();
    renderWidget(
      { type: 'actionButton', label: 'Re-run', action: WIDGET_ACTIONS.REFRESH },
      onAction as never,
    );
    const btn = screen.getByRole('button', { name: 'Re-run' });
    expect(btn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith(WIDGET_ACTIONS.REFRESH);
  });

  // A button that looks live and does nothing is worse than one that admits it.
  it('disables a known action when the host passes no handler', () => {
    renderWidget({ type: 'actionButton', label: 'Re-run', action: WIDGET_ACTIONS.REFRESH });
    expect(screen.getByRole('button', { name: 'Re-run' }).hasAttribute('disabled')).toBe(true);
  });

  it('disables an action the host cannot service, and says so', () => {
    const onAction = vi.fn();
    renderWidget(
      { type: 'actionButton', label: 'Delete everything', action: 'nuke.all' },
      onAction as never,
    );
    const btn = screen.getByRole('button', { name: 'Delete everything' });
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/isn't available/i);
    fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('passes the handler down through containers', () => {
    const onAction = vi.fn();
    renderWidget(
      {
        type: 'card',
        children: [
          { type: 'section', children: [{ type: 'actionButton', label: 'Go', action: WIDGET_ACTIONS.VIEW_RUNS }] },
        ],
      },
      onAction as never,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onAction).toHaveBeenCalledWith(WIDGET_ACTIONS.VIEW_RUNS);
  });
});

describe('WidgetRenderer — injection safety', () => {
  // The catalogue's promise is that a generated tile cannot inject markup.
  it('escapes markup in text rather than rendering it', () => {
    const { container } = renderWidget({
      type: 'text',
      text: '<img src=x onerror="alert(1)"> <script>alert(2)</script>',
    });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeTruthy(); // rendered as literal text
  });

  it('escapes markup inside table cells and list items', () => {
    const { container } = renderWidget({
      type: 'table',
      columns: ['<b>col</b>'],
      rows: [['<script>x</script>']],
    });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('never renders a remote image (the coercer drops it first)', () => {
    const { container } = renderWidget({ type: 'image', src: 'https://tracker.test/p.png' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('renders a data: image', () => {
    renderWidget({ type: 'image', src: 'data:image/png;base64,AAAA', alt: 'chart' });
    const img = screen.getByAltText('chart') as HTMLImageElement;
    expect(img.getAttribute('src')!.startsWith('data:image/')).toBe(true);
  });
});

describe('WidgetRenderer — every catalogued type renders', () => {
  // Guards against adding a node type to the catalogue and forgetting the
  // renderer branch, which would silently drop it from every tile.
  const samples: unknown[] = [
    { type: 'text', text: 'a' },
    { type: 'metric', label: 'a', value: '1' },
    { type: 'statGrid', items: [{ label: 'a', value: '1' }] },
    { type: 'list', items: [{ text: 'a' }] },
    { type: 'table', columns: ['a'], rows: [['1']] },
    { type: 'keyValue', rows: [{ key: 'a', value: '1' }] },
    { type: 'badge', text: 'a' },
    { type: 'timeline', items: [{ title: 'a' }] },
    { type: 'progress', value: 10 },
    { type: 'chart', chart: 'bar', points: [{ label: 'a', value: 1 }] },
    { type: 'divider' },
    { type: 'image', src: 'data:image/png;base64,AAAA' },
    { type: 'actionButton', label: 'a', action: WIDGET_ACTIONS.REFRESH },
    { type: 'section', children: [{ type: 'divider' }] },
    { type: 'card', children: [{ type: 'divider' }] },
  ];

  it('produces output for all 15 primitives', () => {
    for (const sample of samples) {
      cleanup();
      const node = parseWidget(sample) as WidgetNode;
      expect(node, JSON.stringify(sample)).not.toBeNull();
      const { container } = render(<WidgetRenderer node={node} />);
      expect(container.innerHTML.length, `${node.type} rendered nothing`).toBeGreaterThan(0);
    }
  });
});
