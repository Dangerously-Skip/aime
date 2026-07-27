// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ConnectorRequestCard } from './connector-request-card';
import { useConnectorStore } from '@/stores/connector-store';

/**
 * The card's contract with the paused agent turn: it must ALWAYS report an
 * outcome to /api/chat/connector-result. If it ever fails to, the agent sits
 * blocked for the full five-minute timeout — so every exit path is asserted,
 * including the ones that look like dead ends.
 *
 * The OAuth dances are stubbed (they open real windows); the orchestrator, the
 * store writes and the reporting fetch are real.
 */

const startOAuthFlow = vi.fn();
const runMcpOAuthFlow = vi.fn();
const provisionConnector = vi.fn();

vi.mock('@/lib/connectors/oauth', () => ({ startOAuthFlow: (...a: unknown[]) => startOAuthFlow(...a) }));
vi.mock('@/lib/mcp/oauth-flow', () => ({ runMcpOAuthFlow: (...a: unknown[]) => runMcpOAuthFlow(...a) }));
vi.mock('@/lib/connectors/provisioner', () => ({
  provisionConnector: (...a: unknown[]) => provisionConnector(...a),
}));

const fetchMock = vi.fn();
const reports = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes('/api/chat/connector-result'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  startOAuthFlow.mockResolvedValue({ accessToken: 'at', expiresIn: 3600 });
  runMcpOAuthFlow.mockResolvedValue({ accessToken: 'mcp-at', expiresIn: 3600 });
  provisionConnector.mockResolvedValue(undefined);
  useConnectorStore.setState({ connectorStates: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderCard = (connectorId: string, reason = 'to send the summary to Bob') =>
  render(<ConnectorRequestCard toolUseId="tu-1" connectorId={connectorId} reason={reason} />);

describe('ConnectorRequestCard — the happy path', () => {
  it('shows what it wants and why', () => {
    renderCard('atlassian');
    expect(screen.getByText('Connect Atlassian?')).toBeTruthy();
    expect(screen.getByText('to send the summary to Bob')).toBeTruthy();
  });

  it('connects a one-click service and reports success', async () => {
    renderCard('atlassian');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(runMcpOAuthFlow).toHaveBeenCalled());
    await waitFor(() => expect(reports()).toEqual([{ toolUseId: 'tu-1', connected: true }]));
    expect(useConnectorStore.getState().connectorStates['atlassian']?.authenticated).toBe(true);
    expect(await screen.findByText(/Connected — continuing/)).toBeTruthy();
  });

  it('does not re-provision an mcp-oauth connector', async () => {
    renderCard('miro');
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(reports()).toHaveLength(1));
    expect(provisionConnector).not.toHaveBeenCalled();
  });

  it('collects a token inline for api_key services and provisions with it', async () => {
    renderCard('github');
    fireEvent.click(screen.getByText('Connect'));

    const input = await screen.findByLabelText('API token');
    fireEvent.change(input, { target: { value: 'ghp_x' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(reports()).toEqual([{ toolUseId: 'tu-1', connected: true }]));
    expect(provisionConnector.mock.calls[0][1]).toBe('ghp_x');
  });
});

describe('ConnectorRequestCard — every exit path reports back', () => {
  it('reports a decline when the user picks Not now', async () => {
    renderCard('atlassian');
    fireEvent.click(screen.getByText('Not now'));

    await waitFor(() => expect(reports()).toHaveLength(1));
    expect(reports()[0]).toMatchObject({ connected: false });
    expect(reports()[0].reason).toMatch(/declined/i);
    expect(runMcpOAuthFlow).not.toHaveBeenCalled();
    expect(await screen.findByText('Skipped')).toBeTruthy();
  });

  it('reports a cancellation when the user closes the auth window', async () => {
    runMcpOAuthFlow.mockRejectedValue(new Error('OAuth flow was canceled'));
    renderCard('atlassian');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(reports()).toHaveLength(1));
    expect(reports()[0].connected).toBe(false);
  });

  it('reports a failure with its reason and offers a retry', async () => {
    runMcpOAuthFlow.mockRejectedValue(new Error('Server rejected the client'));
    renderCard('atlassian');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(reports()).toHaveLength(1));
    expect(reports()[0]).toMatchObject({ connected: false });
    expect(reports()[0].reason).toMatch(/Server rejected the client/);
    expect(await screen.findByText('Try again')).toBeTruthy();
  });

  it('reports when the user abandons the inline token prompt', async () => {
    // Otherwise the agent waits out the whole timeout for nothing.
    renderCard('github');
    fireEvent.click(screen.getByText('Connect'));
    fireEvent.click(await screen.findByText('Cancel'));

    await waitFor(() => expect(reports()).toHaveLength(1));
    expect(reports()[0].connected).toBe(false);
  });

  it('reports immediately when the agent invents an unknown connector id', async () => {
    render(<ConnectorRequestCard toolUseId="tu-1" connectorId="not-a-service" />);
    await waitFor(() => expect(reports()).toHaveLength(1));
    expect(reports()[0].connected).toBe(false);
    expect(reports()[0].reason).toMatch(/no connector with id/i);
    expect(screen.getByText(/Requested an unknown service/)).toBeTruthy();
  });

  it('reports a failure when provisioning fails after a successful sign-in', async () => {
    provisionConnector.mockRejectedValue(new Error('disk full'));
    renderCard('github');
    fireEvent.click(screen.getByText('Connect'));
    fireEvent.change(await screen.findByLabelText('API token'), { target: { value: 't' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(reports()).toHaveLength(1));
    expect(reports()[0]).toMatchObject({ connected: false });
    expect(reports()[0].reason).toMatch(/disk full/);
  });
});

describe('ConnectorRequestCard — already-answered replay', () => {
  it('renders settled without offering buttons or reporting again', () => {
    useConnectorStore.setState({
      connectorStates: { atlassian: { id: 'atlassian', enabled: true, authenticated: true } },
    } as never);
    render(
      <ConnectorRequestCard toolUseId="tu-1" connectorId="atlassian" reason="r" settled />,
    );
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
    expect(screen.queryByText('Not now')).toBeNull();
    expect(reports()).toHaveLength(0);
  });

  it('does not claim a connection the user declined', () => {
    // A replayed card knows only that it was answered. Claiming "Connected" for
    // a card the user skipped is the same class of lie the settled flag exists to
    // stop: the store says whether the service is actually connected.
    render(
      <ConnectorRequestCard toolUseId="tu-1" connectorId="atlassian" reason="r" settled />,
    );
    expect(screen.queryByText(/Connected/)).toBeNull();
    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
  });
});

describe('ConnectorRequestCard — settling is reported to the surface (DEFECT 2)', () => {
  it('tells the surface to mark the message settled after a successful connect', async () => {
    const onSettled = vi.fn();
    render(
      <ConnectorRequestCard toolUseId="tu-1" connectorId="atlassian" onSettled={onSettled} />,
    );
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith('tu-1'));
  });

  it('tells the surface to mark the message settled after a decline', async () => {
    const onSettled = vi.fn();
    render(
      <ConnectorRequestCard toolUseId="tu-1" connectorId="atlassian" onSettled={onSettled} />,
    );
    fireEvent.click(screen.getByText('Not now'));

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith('tu-1'));
  });

  it('marks an unknown connector settled so it is not re-reported on every remount', async () => {
    const onSettled = vi.fn();
    render(
      <ConnectorRequestCard toolUseId="tu-1" connectorId="not-a-service" onSettled={onSettled} />,
    );
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith('tu-1'));
  });

  it('leaves a retryable failure unsettled — the buttons must stay live', async () => {
    const onSettled = vi.fn();
    runMcpOAuthFlow.mockRejectedValue(new Error('Server rejected the client'));
    render(
      <ConnectorRequestCard toolUseId="tu-1" connectorId="atlassian" onSettled={onSettled} />,
    );
    fireEvent.click(screen.getByText('Connect'));

    expect(await screen.findByText('Try again')).toBeTruthy();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('reports nothing at all when replaying an already-settled unknown connector', async () => {
    render(<ConnectorRequestCard toolUseId="tu-1" connectorId="not-a-service" settled />);
    await waitFor(() => expect(screen.getByText(/unknown service/)).toBeTruthy());
    expect(reports()).toHaveLength(0);
  });
});

describe('ConnectorRequestCard — an undelivered outcome is not reported as success', () => {
  it('does not claim it is continuing when the paused turn no longer exists', async () => {
    // The waiter is gone (the turn timed out, or the app restarted), so the POST
    // 404s. The connection itself succeeded, but nothing is going to continue —
    // and the swallowed `.catch(() => {})` used to leave the card saying it would.
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/chat/connector-result')) {
        return new Response('{"error":"unknown toolUseId"}', { status: 404 });
      }
      return new Response('{}', { status: 200 });
    });
    render(<ConnectorRequestCard toolUseId="tu-gone" connectorId="atlassian" />);
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() =>
      expect(useConnectorStore.getState().connectorStates['atlassian']?.authenticated).toBe(true),
    );
    expect(screen.queryByText(/Connected — continuing/)).toBeNull();
    expect(await screen.findByText(/no longer waiting|ask again/i)).toBeTruthy();
  });

  it('still settles the card, because re-running the whole OAuth flow would fix nothing', async () => {
    const onSettled = vi.fn();
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/chat/connector-result')) {
        return new Response('{}', { status: 404 });
      }
      return new Response('{}', { status: 200 });
    });
    render(
      <ConnectorRequestCard toolUseId="tu-gone" connectorId="atlassian" onSettled={onSettled} />,
    );
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith('tu-gone'));
  });
});

describe('ConnectorRequestCard — rendering has no side effects (DEFECT 4)', () => {
  it('does not report an unknown connector from the render pass', async () => {
    // It used to call setState and fire the POST from the render body. It
    // happened to produce one request under StrictMode only because React landed
    // the render-phase update before the duplicate invocation — an accident, not
    // a design. Rendering must decide what to show and nothing else.
    const { renderToStaticMarkup } = await import('react-dom/server');
    renderToStaticMarkup(<ConnectorRequestCard toolUseId="tu-1" connectorId="not-a-service" />);
    expect(reports()).toHaveLength(0);
  });

  it('still reports exactly once when actually mounted, StrictMode included', async () => {
    const { StrictMode } = await import('react');
    render(
      <StrictMode>
        <ConnectorRequestCard toolUseId="tu-1" connectorId="not-a-service" />
      </StrictMode>,
    );
    await waitFor(() => expect(reports()).toHaveLength(1));
    expect(reports()[0].reason).toMatch(/no connector with id/i);
  });
});
