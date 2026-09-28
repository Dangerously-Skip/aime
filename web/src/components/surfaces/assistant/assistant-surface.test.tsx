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
  useAssistantStore.setState({ cards: [], orders: [] });
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

describe('server errors are visible on the card', () => {
  it('an SSE error event replaces "Thinking..." with the message', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant'
        ? sseResponse([{ type: 'error', message: 'Tool "Bash" was stopped after 570s.' }])
        : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('long build');
    await waitFor(() =>
      expect(useAssistantStore.getState().cards[0]?.summary).toContain('stopped after 570s'),
    );
    expect(screen.queryByText('Thinking...')).toBeNull();
  });

  it('composes partial text with a late error instead of losing either', async () => {
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
    await waitFor(() =>
      expect(useAssistantStore.getState().cards[0]?.summary).toContain('partial findings'),
    );
    const summary = useAssistantStore.getState().cards[0]!.summary;
    expect(summary).toContain('run cancelled');
  });

  it('a non-OK response shows the body\'s error field, not empty statusText', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant' ? json({ error: 'No credentials configured.' }, 503) : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('x');
    await waitFor(() =>
      expect(useAssistantStore.getState().cards[0]?.summary).toContain('No credentials configured.'),
    );
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
  it('omits model when nothing resolves, letting the server fall back to its registry', async () => {
    vi.stubGlobal('fetch', stubFetch((url) =>
      url === '/api/chat/assistant' ? sseResponse([]) : undefined,
    ));
    renderSurface();
    publishScheduledPrompt('hello');
    await waitFor(() => expect(chatPost()).toBeDefined());
    const body = JSON.stringify(chatPost()!.body);
    // The regression shipped `model: 'sonnet'` unconditionally, which skipped
    // server-side registry resolution entirely.
    expect(body).not.toContain('"model"');
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
