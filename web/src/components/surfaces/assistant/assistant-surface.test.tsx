// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { AssistantSurface, StatusBar, cardAsksQuestion, formatCardTime, buildCardReply } from './assistant-surface';
import { useRunStore } from '@/stores/run-store';
import type { Run } from '@/lib/runs/types';
import { useAssistantStore } from '@/stores/assistant-store';
import { useContextBusStore } from '@/stores/context-bus-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useProviderStore } from '@/stores/provider-store';
import { resetServerCredentials, useServerCredentialsStore } from '@/hooks/use-builtin-access';

/**
 * Regressions from the assistant surface's bespoke turn path. It discarded the
 * scheduled prompt argument (a due job with an empty composer did nothing),
 * dropped every SSE `error` event (the card said "Thinking..." forever), and
 * updated its streaming card BY INDEX — so a standing-order card landing
 * mid-stream received another turn's text.
 */

const encoder = new TextEncoder();

/** Build a Response whose body is an SSE stream; functions in `events` run between frames. */
function sseResponse(events: Array<unknown | (() => void)>): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        if (typeof e === 'function') e();
        else controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type FetchCall = { url: string; body: Record<string, unknown> };
let calls: FetchCall[] = [];

/** Route fetches by URL: chat POSTs to the test's responder, everything else gets `{}`. */
function stubFetch(respond: (url: string, body: Record<string, unknown>) => Response | undefined) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let parsed: Record<string, unknown> = {};
    try {
      if (init?.body && typeof init.body === 'string') parsed = JSON.parse(init.body);
    } catch { /* not JSON */ }
    calls.push({ url, body: parsed });
    const custom = respond(url, parsed);
    if (custom) return custom;
    if (url.includes('/api/runs')) return json({ runs: [] });
    // A model is set up, so the composer sends rather than showing "Connect a model".
    if (url.includes('/api/models')) return json({ anthropic: true, bedrock: false });
    return json({});
  });
}

const chatPost = () => calls.find((c) => c.url === '/api/chat/assistant');

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // base-ui's ScrollArea calls viewport.getAnimations() from a timer; jsdom
  // has neither the method nor the animations, so it throws after the test.
  Element.prototype.getAnimations ??= () => [];
  vi.stubGlobal('fetch', stubFetch(() => undefined));
  calls = [];
  useAssistantStore.setState({ cards: [], orders: [], activity: [] });
  useRunStore.setState({ runs: [], goals: [] });
  useContextBusStore.setState({ events: [] });
  useProviderStore.setState({ providers: [] });
  useSettingsStore.setState({ anthropicApiKey: null, tierModels: {} });
  resetServerCredentials();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderSurface = () => render(<AssistantSurface />);

const publishScheduledPrompt = (prompt: string) => {
  useContextBusStore.getState().publish({
    source: 'cron:job-1',
    priority: 'p1',
    targetSurface: 'assistant',
    summary: prompt,
    payload: { prompt, cronJobId: 'job-1' },
  } as never);
};

describe('a scheduled prompt runs even when the composer is empty', () => {
  it('sends the scheduled prompt, not the composer contents', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant'
        ? sseResponse([{ type: 'text', content: 'done' }])
        : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('Check my emails');
    await waitFor(() => expect(chatPost()).toBeDefined());
    expect(chatPost()!.body.message).toBe('Check my emails');
    // The card is titled by the RUN, not left as "Thinking...".
    await waitFor(() =>
      expect(useAssistantStore.getState().cards[0]?.summary).toBe('done'),
    );
    expect(useAssistantStore.getState().cards[0]?.title).toBe('Check my emails');
  });

  it('does not run stale composer text instead of the scheduled prompt', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant' ? sseResponse([]) : undefined,
    ));
    const { container } = renderSurface();
    const textarea = container.querySelector('textarea')!;
    // The user left something half-typed in the composer...
    textarea.value = 'leftover draft';
    // ...the scheduled job must still run ITS OWN prompt.
    publishScheduledPrompt('Morning briefing');
    await waitFor(() => expect(chatPost()).toBeDefined());
    expect(chatPost()!.body.message).toBe('Morning briefing');
  });
});

/*
 * A failure is the same typed banner a chat reply gets — beside the card's
 * text, never written into it — with Try again when retrying could help.
 */
describe('server errors are visible on the card', () => {
  it('an SSE error event replaces "Thinking..." with a banner', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant'
        ? sseResponse([{ type: 'error', message: 'Tool "Bash" was stopped after 570s.' }])
        : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('long build');
    await waitFor(() =>
      expect(useAssistantStore.getState().cards[0]?.error?.message).toContain('stopped after 570s'),
    );
    await waitFor(() => expect(screen.queryByText('Thinking...')).toBeNull());
    expect(screen.getByRole('alert').textContent).toMatch(/stopped/i);
  });

  it('keeps partial text AND the late error, instead of losing either', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant'
        ? sseResponse([
            { type: 'text', content: 'partial findings' },
            { type: 'error', message: 'run cancelled' },
          ])
        : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('research');
    await waitFor(() => expect(useAssistantStore.getState().cards[0]?.error?.message).toBe('run cancelled'));
    const card = useAssistantStore.getState().cards[0]!;
    expect(card.summary).toBe('partial findings');
    expect(card.summary).not.toMatch(/Error/);
  });

  it('a non-OK response says what our route said, and never echoes a raw page', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant' ? json({ error: 'Message exceeds max length' }, 400) : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('x');
    await waitFor(() =>
      expect(useAssistantStore.getState().cards[0]?.error?.message).toBe('Message exceeds max length'),
    );

    cleanup();
    useAssistantStore.setState({ cards: [] });
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant' ? new Response('<html>Traceback: internals</html>', { status: 500 }) : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('y');
    await waitFor(() => expect(useAssistantStore.getState().cards[0]?.error).toBeDefined());
    expect(useAssistantStore.getState().cards[0]!.error!.message).not.toMatch(/Traceback/);
  });

  it('Try again runs the same prompt into the same card', async () => {
    let attempt = 0;
    vi.stubGlobal('fetch', stubFetch((url) => {
      if (url !== '/api/chat/assistant') return undefined;
      attempt += 1;
      return attempt === 1
        ? sseResponse([{ type: 'error', message: 'Overloaded', code: 'overloaded' }])
        : sseResponse([{ type: 'text', content: 'All good.' }]);
    }));
    renderSurface();
    publishScheduledPrompt('check the build');
    await waitFor(() => expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(useAssistantStore.getState().cards[0]?.summary).toBe('All good.'));
    const cards = useAssistantStore.getState().cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].error).toBeUndefined();
    const posts = calls.filter((c) => c.url === '/api/chat/assistant');
    expect(posts.map((p) => p.body.message)).toEqual(['check the build', 'check the build']);
    // A new turn, not a resumption of the one that failed.
    expect(posts[1].body.chatId).not.toBe(posts[0].body.chatId);
  });
});

describe('the streaming card is addressed by id, not position', () => {
  it('text still lands on the turn card after another card is prepended mid-stream', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant'
        ? sseResponse([
            { type: 'text', content: 'first ' },
            // A standing-order result lands mid-stream; addCard PREPENDS it.
            () => useAssistantStore.getState().addCard({ title: 'order ran', summary: 'ok' }),
            { type: 'text', content: 'second' },
          ])
        : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('my turn');
    await waitFor(() => {
      const mine = useAssistantStore.getState().cards.find((c) => c.title === 'my turn');
      expect(mine?.summary).toBe('first second');
    });
    // And the intruder kept its own summary.
    const intruder = useAssistantStore.getState().cards.find((c) => c.title === 'order ran');
    expect(intruder?.summary).toBe('ok');
  });
});

describe('the model comes from the route chokepoint, not a hardcoded name', () => {
  it('pins no model when nothing resolves, letting the server fall back to its registry', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant'
        ? sseResponse([])
        // Nothing configured here, so nothing can resolve.
        : url.includes('/api/models') ? json({}) : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('hello');
    await waitFor(() => expect(chatPost()).toBeDefined());
    // The regression shipped `model: 'sonnet'` unconditionally, which skipped
    // server-side registry resolution entirely. null means "resolve it there".
    expect(chatPost()!.body.model ?? null).toBeNull();
  });

  it('sends the resolved provider config for a BYOK-only user', async () => {
    // A provider whose models can fill the chat tiers; resolveSendRoute(null)
    // should land the turn there instead of demanding an Anthropic key.
    // Fixture shape matches byok-default-route.test.ts.
    useSettingsStore.setState({
      anthropicApiKey: null,
      tierModels: {},
    });
    useServerCredentialsStore.setState({ server: { anthropic: false, bedrock: false } });
    useProviderStore.setState({
      providers: [
        {
          id: 'prov1',
          presetId: 'openrouter',
          label: 'OpenRouter',
          enabled: true,
          models: [
            {
              id: 'vendor/model-0',
              label: 'Model 0',
              capabilities: ['chat', 'code'],
              contextWindow: 200_000,
              pricing: { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },
            },
          ],
        },
      ] as never,
    });
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant' ? sseResponse([]) : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('hello');
    await waitFor(() => expect(chatPost()).toBeDefined());
    expect(chatPost()!.body.model).toBe('vendor/model-0');
    expect(chatPost()!.body.providerConfig).toMatchObject({ providerId: 'prov1' });
  });
});

describe('this surface records its turns as Runs, with the right outcome', () => {
  it('a turn that reports an error is recorded as failed', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant'
        ? sseResponse([{ type: 'error', code: 'auth', message: 'No API key' }])
        : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('remind me');
    await waitFor(() => expect(useRunStore.getState().runs[0]?.status).toBe('failed'));
    expect(useRunStore.getState().runs[0]).toMatchObject({ surfaceId: 'assistant', trigger: 'cron', error: 'No API key' });
  });

  it('a clean turn is recorded as succeeded', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant' ? sseResponse([{ type: 'text', content: 'ok' }]) : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('hello');
    await waitFor(() => expect(useRunStore.getState().runs[0]?.status).toBe('succeeded'));
  });
});

describe('StatusBar', () => {
  const run = (status: Run['status']): Run => ({
    id: crypto.randomUUID(), goalId: null, trigger: 'chat', status, startedAt: 1, deliverables: [],
  } as unknown as Run);

  it('counts the same runs the log shows — not the orders\' runCount', () => {
    // The regression: a failed chat turn listed in Recent Activity while the
    // footer, summing standing-order runCount, said "0 total runs".
    render(<StatusBar orders={[]} runs={[run('succeeded'), run('failed')]} />);
    expect(screen.getByText('2 runs recorded')).toBeTruthy();
    expect(screen.getByText('1 failed')).toBeTruthy();
  });
});

/** A turn that streams one chunk and then stays open until aborted. */
function stubHangingTurn() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init?.body ?? '{}')); } catch { /* not JSON */ }
    calls.push({ url, body });
    if (url.includes('/api/models')) return json({ anthropic: true, bedrock: false });
    if (url !== '/api/chat/assistant') return url.includes('/api/runs') ? json({ runs: [] }) : json({});
    const signal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: 'partial' })}\n\n`));
        signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      },
    }), { status: 200 });
  }));
}

const composer = (container: HTMLElement) => container.querySelector('textarea')!;

describe('the composer: Enter sends, Esc stops, IME is left alone', () => {
  it('Enter while a reply is streaming does NOT abort it', async () => {
    stubHangingTurn();
    const { container } = renderSurface();
    fireEvent.change(composer(container), { target: { value: 'first' } });
    fireEvent.keyDown(composer(container), { key: 'Enter' });
    await waitFor(() => expect(useAssistantStore.getState().cards[0]?.summary).toBe('partial'));

    fireEvent.change(composer(container), { target: { value: 'follow-up I am typing' } });
    fireEvent.keyDown(composer(container), { key: 'Enter' });
    // Still streaming: the Stop button is still there, and no second turn began.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(calls.filter((c) => c.url === '/api/chat/assistant')).toHaveLength(1);
  });

  it('Esc stops, and the card says so instead of "Thinking..." for ever', async () => {
    stubHangingTurn();
    const { container } = renderSurface();
    fireEvent.change(composer(container), { target: { value: 'long task' } });
    fireEvent.keyDown(composer(container), { key: 'Enter' });
    await waitFor(() => expect(useAssistantStore.getState().cards[0]?.summary).toBe('partial'));

    fireEvent.keyDown(composer(container), { key: 'Escape' });
    await waitFor(() => expect(useAssistantStore.getState().cards[0]?.summary).toBe('partial\n\n_Stopped._'));
    await waitFor(() => expect(useRunStore.getState().runs[0]?.status).toBe('cancelled'));
  });

  it('a stop before any text leaves "Stopped.", not "Thinking..."', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/api/chat/assistant') return json({ runs: [] });
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }));
    const { container } = renderSurface();
    fireEvent.change(composer(container), { target: { value: 'x' } });
    fireEvent.keyDown(composer(container), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(useAssistantStore.getState().cards[0]?.summary).toBe('Stopped.'));
  });

  it('Enter that commits an IME composition does not send', () => {
    const { container } = renderSurface();
    fireEvent.change(composer(container), { target: { value: 'にほん' } });
    fireEvent.keyDown(composer(container), { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(chatPost()).toBeUndefined();
    expect(composer(container).value).toBe('にほん');
  });

  /*
   * One surface-wide `isStreaming` meant a scheduled run locked the composer
   * and Stop stopped whichever turn happened to be running.
   */
  it('each card is its own turn: a running scheduled card neither locks the composer nor is stopped by it', async () => {
    stubHangingTurn();
    const { container } = renderSurface();
    publishScheduledPrompt('Morning briefing');
    await waitFor(() => expect(useAssistantStore.getState().cards[0]?.summary).toBe('partial'));
    // The composer is free: Send, not a Stop for somebody else's turn.
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    fireEvent.change(composer(container), { target: { value: 'my own question' } });
    fireEvent.keyDown(composer(container), { key: 'Enter' });
    await waitFor(() => expect(useAssistantStore.getState().cards).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    const byTitle = (t: string) => useAssistantStore.getState().cards.find((c) => c.title === t)!;
    await waitFor(() => expect(byTitle('my own question').summary).toMatch(/Stopped/));
    expect(byTitle('Morning briefing').summary).toBe('partial');
    // The scheduled card has a Stop of its own.
    expect(screen.getAllByRole('button', { name: 'Stop this reply' })).toHaveLength(1);
  });

  it('with nothing to answer, says "Connect a model" instead of starting a card', async () => {
    vi.stubGlobal('fetch', stubFetch((url) => (url.includes('/api/models') ? json({}) : undefined)));
    const { container } = renderSurface();
    await waitFor(() => expect(screen.getByText('No model is set up yet')).toBeTruthy());
    fireEvent.change(composer(container), { target: { value: 'remind me at 5' } });
    fireEvent.keyDown(composer(container), { key: 'Enter' });
    expect(chatPost()).toBeUndefined();
    expect(useAssistantStore.getState().cards).toHaveLength(0);
    expect(composer(container).value).toBe('remind me at 5');
  });
});

describe('cards', () => {
  it('only a card that ends in a question offers Reply', () => {
    expect(cardAsksQuestion('Build is green, somewhat slower. However, showing no failures whenever it ran.')).toBe(false);
    expect(cardAsksQuestion('Here is how to fix it.')).toBe(false);
    expect(cardAsksQuestion('Three flights found. Which one should I book?')).toBe(true);
    expect(cardAsksQuestion('Want me to file it? **')).toBe(true);
    expect(cardAsksQuestion(undefined)).toBe(false);
  });

  it('shows a date on cards from before today', () => {
    const now = new Date(2026, 6, 20, 12, 0).getTime();
    const today = formatCardTime(new Date(2026, 6, 20, 9, 5).getTime(), now);
    const older = formatCardTime(new Date(2026, 6, 18, 9, 5).getTime(), now);
    expect(today).not.toMatch(/Jul/);
    expect(older).toMatch(/Jul/);
    expect(older).toMatch(/18/);
  });

  it('a reply carries the card it answers, not just its title', async () => {
    const reply = buildCardReply({ title: 'Flights', summary: 'A: 9am\nB: 1pm\nWhich should I book?' }, 'B please');
    expect(reply).toContain('> A: 9am');
    expect(reply).toContain('> B: 1pm');
    expect(reply.endsWith('B please')).toBe(true);

    // …and through the surface.
    vi.stubGlobal('fetch', stubFetch((url) => (url === '/api/chat/assistant' ? sseResponse([]) : undefined)));
    useAssistantStore.setState({
      cards: [{ id: 'c1', title: 'Flights', summary: 'A: 9am\nB: 1pm\nWhich should I book?', timestamp: Date.now(), unread: true, pinned: false }],
    });
    renderSurface();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByPlaceholderText('Type a reply...'), { target: { value: 'B please' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(chatPost()).toBeDefined());
    expect(chatPost()!.body.message).toContain('> B: 1pm');
  });
});

describe('the sidebar', () => {
  const seedOrder = () =>
    useAssistantStore.setState({
      orders: [{
        id: 'o1', instruction: 'Stretch', trigger: { type: 'cron', expression: '0 9 * * 1-5' }, state: {},
        status: 'active', notifyVia: 'toast', runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1,
      }],
    });

  it('shows schedules in words, not cron', () => {
    seedOrder();
    renderSurface();
    expect(screen.getByText('Weekdays at 9:00 AM')).toBeTruthy();
    expect(screen.queryByText('0 9 * * 1-5')).toBeNull();
  });

  it('asks before deleting', () => {
    seedOrder();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSurface();
    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule' }));
    expect(confirm).toHaveBeenCalled();
    expect(useAssistantStore.getState().orders).toHaveLength(1);
  });

  it('has one Quick Start, not two', () => {
    renderSurface();
    expect(screen.getAllByText('Quick Start')).toHaveLength(1);
    // The centre empty state no longer duplicates it with its own buttons.
    expect(screen.queryByRole('button', { name: /Stretch reminder/ })).toBeNull();
  });
});

describe('failures are visible on the Activity tab', () => {
  it('leads with "Needs attention" and badges the tab when a schedule is failing', async () => {
    useAssistantStore.setState({
      orders: [{
        id: 'o1', instruction: 'Nightly digest', trigger: { type: 'interval', expression: '1d' }, state: {},
        status: 'active', notifyVia: 'toast', runCount: 3, errorCount: 1, createdAt: Date.now() - 3_600_000,
        lastRun: Date.now() - 60_000, updatedAt: 1,
      }],
      activity: [{ id: 'a1', orderId: 'o1', type: 'order-error', label: 'Error: upstream 502', timestamp: Date.now() }],
    });
    renderSurface();
    expect(screen.getByRole('region', { name: 'Schedules needing attention' })).toBeTruthy();
    expect(screen.getByText('Error: upstream 502')).toBeTruthy();
    expect(screen.getByLabelText('1 schedule need attention')).toBeTruthy();
    // Clicking it opens that schedule.
    fireEvent.click(screen.getByRole('button', { name: /Nightly digest.*upstream 502/ }));
    expect(screen.getByRole('dialog', { name: 'Edit schedule' })).toBeTruthy();
  });

  it('renders a failure card as a failure', () => {
    useAssistantStore.setState({
      cards: [{ id: 'c1', title: 'Failed: Nightly digest', summary: 'upstream 502', tone: 'error', timestamp: Date.now(), unread: true, pinned: false }],
    });
    const { container } = renderSurface();
    expect(container.querySelector('[data-tone="error"]')).toBeTruthy();
    expect(screen.getByLabelText('Failed')).toBeTruthy();
  });

  it('shows nothing extra when all is well', () => {
    renderSurface();
    expect(screen.queryByRole('region', { name: 'Schedules needing attention' })).toBeNull();
  });
});
