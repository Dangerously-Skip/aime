// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSSEStream } from './use-sse-stream';
import { useConnectorStore } from '@/stores/connector-store';

/**
 * The Connectors screen's enable/disable toggle did nothing for its whole life:
 * `getEnabledConnectorIds()` existed and was never called, so every provisioned
 * connector was mounted on every request.
 *
 * The deny list is resolved inside the hook rather than at each call site because
 * there are five send sites across four surfaces — chat, cowork (three), code and
 * project detail — and the last time per-site wiring was needed, three of them
 * silently dropped the value. Asserting it here pins the choke point: a surface
 * cannot forget something it never has to pass.
 *
 * Only fetch is stubbed; the hook builds the real body.
 */

const fetchMock = vi.fn();

function sseResponse() {
  return new Response(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const sentBody = (): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(sseResponse());
  vi.stubGlobal('fetch', fetchMock);
  useConnectorStore.setState({ tokens: {}, connectorStates: {}, tokenMeta: {} } as never);
});
afterEach(() => vi.unstubAllGlobals());

const harness = () =>
  renderHook(() =>
    useSSEStream({
      chatId: 'c1',
      setIsStreaming: () => {},
      setStreamError: () => {},
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
    }),
  );

const setStates = (states: Record<string, { enabled: boolean; authenticated: boolean }>) =>
  useConnectorStore.setState({
    connectorStates: Object.fromEntries(
      Object.entries(states).map(([id, s]) => [id, { id, ...s }]),
    ),
  } as never);

describe('useSSEStream — disabled connectors reach the server', () => {
  it('sends the ids of connected-but-switched-off connectors', async () => {
    setStates({
      github: { enabled: false, authenticated: true },
      atlassian: { enabled: true, authenticated: true },
    });

    const { result } = harness();
    await result.current.sendMessage('hi', 'c1', 'chat', 'sonnet');

    expect(sentBody().disabledConnectors).toEqual(['github']);
  });

  it('omits the field when nothing is disabled, so everything stays mounted', async () => {
    setStates({ github: { enabled: true, authenticated: true } });

    const { result } = harness();
    await result.current.sendMessage('hi', 'c1', 'chat', 'sonnet');

    expect('disabledConnectors' in sentBody()).toBe(false);
  });

  it('ignores a disabled connector that was never authenticated', async () => {
    // Nothing is provisioned for it, so there is no server to filter.
    setStates({ github: { enabled: false, authenticated: false } });

    const { result } = harness();
    await result.current.sendMessage('hi', 'c1', 'chat', 'sonnet');

    expect('disabledConnectors' in sentBody()).toBe(false);
  });

  it('sends every disabled connector, not just the first', async () => {
    setStates({
      github: { enabled: false, authenticated: true },
      atlassian: { enabled: false, authenticated: true },
      miro: { enabled: true, authenticated: true },
    });

    const { result } = harness();
    await result.current.sendMessage('hi', 'c1', 'chat', 'sonnet');

    expect((sentBody().disabledConnectors as string[]).sort()).toEqual(['atlassian', 'github']);
  });

  it('lets an explicit caller value win over the store', async () => {
    setStates({ github: { enabled: false, authenticated: true } });

    const { result } = harness();
    await result.current.sendMessage('hi', 'c1', 'chat', 'sonnet', {
      disabledConnectors: ['slack'],
    });

    expect(sentBody().disabledConnectors).toEqual(['slack']);
  });

  it('an explicit empty list means "mount everything", overriding the store', async () => {
    setStates({ github: { enabled: false, authenticated: true } });

    const { result } = harness();
    await result.current.sendMessage('hi', 'c1', 'chat', 'sonnet', { disabledConnectors: [] });

    expect('disabledConnectors' in sentBody()).toBe(false);
  });
});
