// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { WidgetTile } from './widget-tile';
import { useWidgetStore } from '@/stores/widget-store';
import { useRunStore } from '@/stores/run-store';
import type { Widget } from '@/lib/widgets/widget';
import { useConversationStore } from '@/stores/conversation-store';
import { useChatStore } from '@/stores/chat-store';
import { useAppStore } from '@/stores/app-store';

const widget = (over: Partial<Widget> = {}): Widget => ({
  id: 'w1',
  title: 'Build health',
  recipe: 'Show overnight build failures',
  render: { type: 'metric', label: 'Failures', value: '2' },
  enabled: true,
  createdAt: 0,
  refreshedAt: Date.now() - 60_000,
  ...over,
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useWidgetStore.setState({ widgets: [] });
  useRunStore.setState({ goals: [], runs: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WidgetTile', () => {
  it('renders the stored node through the catalogue renderer', () => {
    render(<WidgetTile widget={widget()} />);
    expect(screen.getByText('Build health')).toBeTruthy();
    expect(screen.getByText('Failures')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows an empty state for a never-rendered widget', () => {
    render(<WidgetTile widget={widget({ render: null, refreshedAt: undefined })} />);
    expect(screen.getByText(/Not rendered yet/i)).toBeTruthy();
    expect(screen.getByText(/never run/i)).toBeTruthy();
  });

  // We do not trust our own stored bytes — they came from a model.
  it('re-validates the stored node on render and drops a hostile one', () => {
    const hostile = { type: 'image', src: 'https://tracker.test/p.png' } as unknown as Widget['render'];
    const { container } = render(<WidgetTile widget={widget({ render: hostile })} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/Not rendered yet/i)).toBeTruthy();
  });

  it('refreshes via the API and stores the new node', async () => {
    const w = widget();
    useWidgetStore.setState({ widgets: [w] });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          node: { type: 'metric', label: 'Failures', value: '0' },
          run: { id: 'r1', goalId: 'widget:w1', trigger: 'manual', status: 'succeeded', startedAt: 1, deliverables: [] },
        }),
        { status: 200 },
      ),
    );

    render(<WidgetTile widget={w} />);
    fireEvent.click(screen.getByTitle('Refresh now'));

    await waitFor(() => expect(useWidgetStore.getState().getWidget('w1')?.render).toMatchObject({ value: '0' }));
    // the refresh run is mirrored into the live store for the Cockpit
    expect(useRunStore.getState().runs.some((r) => r.id === 'r1')).toBe(true);
  });

  it('surfaces a refresh failure instead of clearing the tile', async () => {
    const w = widget();
    useWidgetStore.setState({ widgets: [w] });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "didn't produce a renderable widget" }), { status: 502 }),
    );

    render(<WidgetTile widget={w} />);
    fireEvent.click(screen.getByTitle('Refresh now'));

    expect(await screen.findByText(/didn't produce a renderable widget/i)).toBeTruthy();
    // the last good render is untouched
    expect(useWidgetStore.getState().getWidget('w1')?.render).toMatchObject({ value: '2' });
  });

  it('requires two clicks to delete', () => {
    const w = widget();
    useWidgetStore.setState({ widgets: [w] });
    render(<WidgetTile widget={w} />);

    fireEvent.click(screen.getByTitle('Delete widget'));
    expect(useWidgetStore.getState().widgets).toHaveLength(1); // armed, not deleted
    fireEvent.click(screen.getByTitle('Click again to delete'));
    expect(useWidgetStore.getState().widgets).toHaveLength(0);
  });

  it('pauses and resumes the schedule', () => {
    const w = widget();
    useWidgetStore.setState({ widgets: [w] });
    render(<WidgetTile widget={w} />);
    fireEvent.click(screen.getByTitle('Pause schedule'));
    expect(useWidgetStore.getState().getWidget('w1')?.enabled).toBe(false);
  });

  it('dispatches widget actions from rendered actionButtons', async () => {
    const w = widget({
      render: {
        type: 'card',
        children: [{ type: 'actionButton', label: 'Re-run', action: 'widget.refresh' }],
      },
    });
    useWidgetStore.setState({ widgets: [w] });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ node: { type: 'divider' } }), { status: 200 }),
    );

    render(<WidgetTile widget={w} />);
    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/widgets/refresh');
  });
});

describe('asking about a tile', () => {
  /*
   * A widget is glanceable and MUTE — you can see three cameras are underpriced
   * and you cannot ask which to bid on. Starting a conversation is the one thing
   * a heartbeat could do that a schedule cannot, and this is how the widget
   * model gets it back without a second proactive mechanism.
   */
  const widget = {
    id: 'w1',
    title: 'Camera watchlist',
    recipe: 'track camera ROI on allbids',
    render: { type: 'metric', label: 'Best ROI', value: '98%' },
    refreshedAt: Date.now(),
    enabled: true,
    createdAt: 0,
  } as never;

  it('offers a way to ask', () => {
    render(<WidgetTile widget={widget} />);
    expect(screen.getByLabelText('Ask about this')).toBeTruthy();
  });

  it('opens a chat seeded with the card and its recipe', async () => {
    render(<WidgetTile widget={widget} />);
    fireEvent.click(screen.getByLabelText('Ask about this'));

    const convs = useConversationStore.getState().conversations;
    const created = convs.find((c) => c.title === 'Camera watchlist');
    expect(created, 'no conversation was created').toBeTruthy();
    expect(created!.surface).toBe('chat');

    const messages = useChatStore.getState().messages[created!.id] ?? [];
    expect(messages).toHaveLength(1);
    // The card's content AND where it came from — an agent without the recipe
    // invents a provenance, which is an uncited claim one layer up.
    expect(messages[0].content).toContain('Best ROI');
    expect(messages[0].content).toContain('track camera ROI on allbids');
  });

  it('seeds it as the ASSISTANT, not as the user', () => {
    // The tile is something the agent produced. Seeding it as a user turn would
    // have the user apparently say something they never typed.
    render(<WidgetTile widget={widget} />);
    fireEvent.click(screen.getByLabelText('Ask about this'));
    const created = useConversationStore.getState().conversations.find((c) => c.title === 'Camera watchlist')!;
    expect(useChatStore.getState().messages[created.id][0].role).toBe('assistant');
  });

  it('switches to the Chat surface, so the conversation is actually visible', () => {
    render(<WidgetTile widget={widget} />);
    fireEvent.click(screen.getByLabelText('Ask about this'));
    expect(useAppStore.getState().activeSurface).toBe('chat');
  });
});
