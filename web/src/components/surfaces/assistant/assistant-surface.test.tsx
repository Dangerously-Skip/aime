// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { AssistantSurface } from './assistant-surface';
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
