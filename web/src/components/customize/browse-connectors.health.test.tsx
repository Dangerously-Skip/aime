// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { BrowseConnectors } from './browse-connectors';
import { useConnectorStore } from '@/stores/connector-store';

/**
 * The regression: `expiresAt` was recorded in the MCP config and never read, so
 * a connection whose token had lapsed with no refresh token showed a green
 * toggle forever. The agent then picked its tools and failed with a 401 deep
 * inside an MCP server, and the user had no idea why.
 *
 * Health comes from the real endpoint shape; only fetch is stubbed.
 */

const fetchMock = vi.fn();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function serve(opts: { needsReconnect?: string[]; detail?: string } = {}) {
  const needs = opts.needsReconnect ?? [];
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/connectors/health')) {
      return json({
        connectors: needs.map((id) => ({
          id,
          serverKey: `aime-connector-${id}`,
          health: {
            status: 'expired',
            needsReconnect: true,
            detail: opts.detail ?? 'Access expired and there is no refresh token — reconnect to restore access.',
          },
        })),
        needsReconnect: needs,
      });
    }
    if (u.includes('/api/connectors/hydrate')) return json({ connectedIds: [] });
    if (u.includes('/api/marketplace')) return json({ plugins: [] });
    if (u.includes('/api/mcp/installed')) return json({ installed: [] });
    return json({});
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  serve();
  vi.stubGlobal('fetch', fetchMock);
  // github reads as connected in the client store
  useConnectorStore.setState({
    tokens: { github: 'provisioned' },
    connectorStates: { github: { id: 'github', enabled: true, authenticated: true } },
    tokenMeta: {},
  } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BrowseConnectors — connection health', () => {
  it('offers Reconnect and explains why when a connection is dead', async () => {
    serve({ needsReconnect: ['github'] });
    render(<BrowseConnectors />);

    expect(await screen.findByText('Reconnect')).toBeTruthy();
    expect(screen.getByText(/no refresh token/)).toBeTruthy();
  });

  it('shows no Reconnect when the connection is healthy', async () => {
    serve({ needsReconnect: [] });
    render(<BrowseConnectors />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/health'))).toBe(true),
    );
    expect(screen.queryByText('Reconnect')).toBeNull();
  });

  it('tells the server which ids the UI believes are connected, so drift is detectable', async () => {
    serve({ needsReconnect: [] });
    render(<BrowseConnectors />);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/health'));
      expect(String(call?.[0])).toContain('clientConnected=github');
    });
  });

  it('renders normally when the health endpoint fails — health is advisory', async () => {
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/connectors/health')) return json({ error: 'boom' }, 500);
      if (u.includes('/api/connectors/hydrate')) return json({ connectedIds: [] });
      return json({ plugins: [], installed: [] });
    });
    render(<BrowseConnectors />);

    // the catalogue still renders
    expect(await screen.findByText('GitHub')).toBeTruthy();
    expect(screen.queryByText('Reconnect')).toBeNull();
  });
});

describe('BrowseConnectors — tool budget (P3.5)', () => {
  it('reports the mounted tool count once a session has been observed', async () => {
    const { useToolBudgetStore } = await import('@/stores/tool-budget-store');
    useToolBudgetStore.getState().setReport({
      total: 42,
      perServer: [{ server: 'aime-connector-github', count: 40 }],
      builtinCount: 2,
      overBudget: false,
    });
    render(<BrowseConnectors />);
    expect(await screen.findByText(/42 tools mounted across 1 service\./)).toBeTruthy();
  });

  it('warns and names what to switch off when over budget', async () => {
    const { useToolBudgetStore } = await import('@/stores/tool-budget-store');
    useToolBudgetStore.getState().setReport({
      total: 260,
      perServer: [
        { server: 'aime-connector-github', count: 200 },
        { server: 'aime-mcp-atlassian', count: 60 },
      ],
      builtinCount: 0,
      overBudget: true,
      advice: '260 tools are mounted (over 120). The largest is aime-connector-github with 200 — switching off services you are not using will improve tool selection.',
    });
    render(<BrowseConnectors />);
    expect(await screen.findByText(/over 120/)).toBeTruthy();
    expect(screen.getByText(/aime-connector-github with 200/)).toBeTruthy();
  });

  it('says nothing before any session has been observed', async () => {
    const { useToolBudgetStore } = await import('@/stores/tool-budget-store');
    useToolBudgetStore.getState().clear();
    render(<BrowseConnectors />);
    await screen.findByText('GitHub');
    expect(screen.queryByText(/tools mounted/)).toBeNull();
  });
});
