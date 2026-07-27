// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { BrowseConnectors } from './browse-connectors';
import { useConnectorStore } from '@/stores/connector-store';

/**
 * "Off" now means ONE thing: the entry is stashed in `config.disabledMcpServers`,
 * so `loadProvisionedMcpServers` never touches it.
 *
 * It used to mean two things at once. The toggle also drove a client-side deny
 * list (`disabledConnectors` on each chat request), and that was the mechanism the
 * chat route actually applied — after paying the full load cost for the server it
 * was about to discard: three AES-256-GCM credential decrypts, an outbound OAuth
 * token-refresh POST and a config rewrite per message (measured in
 * mcp/disabled-connector-cost.test.ts). The deny list is gone, which leaves one
 * loose end that only the client can tie: a store PERSISTED by a build that had
 * only the deny list still says "authenticated, not enabled" while the entry sits
 * in `config.mcpServers`. Nothing server-side knows the user ever switched it off,
 * so without the convergence below, removing the deny list silently switches those
 * services back on.
 *
 * Only fetch is stubbed; the real component, the real store and the real
 * provisioner run.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();

function serve(hydrate: string[]) {
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/connectors/health')) return json({ connectors: [], needsReconnect: [] });
    if (u.includes('/api/connectors/hydrate')) return json({ connectedIds: hydrate });
    if (u.includes('/api/marketplace')) return json({ plugins: [] });
    return json({ success: true });
  });
}

const disableCalls = () =>
  fetchMock.mock.calls.filter(
    (c) =>
      String(c[0]).includes('/api/connectors/provision') &&
      (c[1] as RequestInit | undefined)?.method === 'DELETE',
  );

const state = (id: string) => useConnectorStore.getState().connectorStates[id];

beforeEach(() => {
  fetchMock.mockReset();
  serve([]);
  vi.stubGlobal('fetch', fetchMock);
  useConnectorStore.setState({ connectorStates: {}, tokens: {}, tokenMeta: {}, oauthClientCreds: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The persisted shape a pre-stash build left behind: connected, switched off. */
const switchedOffLocally = (id: string) =>
  useConnectorStore.setState({
    tokens: { [id]: 'ghp_real' },
    connectorStates: { [id]: { id, enabled: false, authenticated: true } },
  } as never);

describe('BrowseConnectors — converging a client-only "off" to the server stash', () => {
  it('pushes the disable to the server for a mounted connector the store says is off', async () => {
    switchedOffLocally('github');
    serve(['github']);
    render(<BrowseConnectors />);

    await waitFor(() => expect(disableCalls()).toHaveLength(1));
    const requested = String(disableCalls()[0][0]);
    expect(requested).toContain('connectorId=github');
    expect(requested).toContain('intent=disable');
    // Reversible: still authenticated, credential untouched.
    expect(state('github')?.authenticated).toBe(true);
    expect(useConnectorStore.getState().tokens['github']).toBe('ghp_real');
  });

  it('REGRESSION: does not silently switch it back on', async () => {
    // markProvisioned sets `enabled: true`, so hydration alone used to overwrite
    // the user's choice the moment they opened the Connectors screen.
    switchedOffLocally('github');
    serve(['github']);
    render(<BrowseConnectors />);

    await waitFor(() => expect(disableCalls()).toHaveLength(1));
    expect(state('github')?.enabled).toBe(false);
  });

  it('leaves a connector that is switched ON alone', async () => {
    useConnectorStore.setState({
      tokens: { github: 'ghp_real' },
      connectorStates: { github: { id: 'github', enabled: true, authenticated: true } },
    } as never);
    serve(['github']);
    render(<BrowseConnectors />);

    await screen.findByText('GitHub');
    await waitFor(() => expect(state('github')?.authenticated).toBe(true));
    expect(disableCalls()).toEqual([]);
    expect(state('github')?.enabled).toBe(true);
  });

  it('marks a connector the store has never seen as connected and enabled', async () => {
    // A fresh profile, or a connector provisioned by the CLI. Nobody switched it
    // off, so there is nothing to converge.
    serve(['github']);
    render(<BrowseConnectors />);

    await waitFor(() => expect(state('github')?.authenticated).toBe(true));
    expect(state('github')?.enabled).toBe(true);
    expect(disableCalls()).toEqual([]);
  });

  it('does NOT stash an mcp-oauth connector, whose toggle is a one-way uninstall', async () => {
    // handleToggle treats "off" for mcp-oauth as a full uninstall and offers no way
    // back on, so stashing one would leave a row that can only be reconnected.
    switchedOffLocally('slack');
    serve(['slack']);
    render(<BrowseConnectors />);

    await waitFor(() => expect(state('slack')?.enabled).toBe(true));
    expect(disableCalls()).toEqual([]);
  });

  it('does not claim the connector is off when the server refuses the disable', async () => {
    switchedOffLocally('github');
    fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/connectors/health')) return json({ connectors: [], needsReconnect: [] });
      if (u.includes('/api/connectors/hydrate')) return json({ connectedIds: ['github'] });
      if (u.includes('/api/marketplace')) return json({ plugins: [] });
      if (u.includes('/api/connectors/provision') && init?.method === 'DELETE') {
        return json({ error: 'nope' }, 500);
      }
      return json({ success: true });
    });
    render(<BrowseConnectors />);

    // The entry IS still mounted, so the UI must say so rather than show an off
    // toggle for a service the agent can still use.
    await waitFor(() => expect(state('github')?.enabled).toBe(true));
  });
});
