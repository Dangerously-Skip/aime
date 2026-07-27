// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { BrowseConnectors } from './browse-connectors';
import { useConnectorStore } from '@/stores/connector-store';
import type { ConnectorHealthReport } from '@/lib/connectors/health';

/**
 * Connector lifecycle in the Connectors screen: what the two off-switches mean,
 * and whether a connected service can actually be seen to be connected.
 *
 * DEFECT 1 — the toggle and the Disconnect button are different operations. The
 *   API distinguishes them (`?intent=disable` vs `?intent=disconnect`); the UI
 *   sent neither, so Disconnect performed a disable and left the credential
 *   encrypted at rest with the upstream grant intact.
 * DEFECT 1b — a re-enable POSTed the literal string 'provisioned' as the
 *   credential, because that is the sentinel hydration wrote into the store.
 * DEFECT 3 — the one-click catalogue's ids (linear, notion, stripe, …) are
 *   deliberately absent from CONNECTOR_MAP, and the connected set was derived
 *   only from the client store, which hydration also filtered through
 *   CONNECTOR_MAP. So every catalogue entry read "Connect" for ever, and
 *   clicking it dragged the user back through a full consent screen for a
 *   service that was already connected.
 *
 * Only fetch is stubbed; the real component, the real store and the real
 * provisioner run.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();

interface ServeOpts {
  hydrate?: string[];
  reports?: ConnectorHealthReport[];
  drift?: { missingInClient: string[]; missingOnDisk: string[] };
}

function serve(opts: ServeOpts = {}) {
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/connectors/health')) {
      const reports = opts.reports ?? [];
      return json({
        connectors: reports,
        needsReconnect: reports.filter((r) => r.health.needsReconnect).map((r) => r.id),
        ...(opts.drift ? { drift: opts.drift } : {}),
      });
    }
    if (u.includes('/api/connectors/hydrate')) return json({ connectedIds: opts.hydrate ?? [] });
    if (u.includes('/api/marketplace')) return json({ plugins: [] });
    return json({ success: true });
  });
}

const healthy = (id: string): ConnectorHealthReport => ({
  id,
  serverKey: `aime-mcp-${id}`,
  health: { status: 'healthy', needsReconnect: false, detail: 'Connected.' },
});

const callsTo = (fragment: string) =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes(fragment));

/** The provision endpoint, split by HTTP verb — the two intents are DELETEs. */
const provisionCalls = (method: string) =>
  callsTo('/api/connectors/provision').filter(
    (c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method,
  );

beforeEach(() => {
  fetchMock.mockReset();
  serve();
  vi.stubGlobal('fetch', fetchMock);
  useConnectorStore.setState({ connectorStates: {}, tokens: {}, tokenMeta: {}, oauthClientCreds: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** github reads as connected in the client store, with a real credential. */
function connectGithub(token = 'ghp_real') {
  useConnectorStore.setState({
    tokens: { github: token },
    connectorStates: { github: { id: 'github', enabled: true, authenticated: true } },
  } as never);
}

describe('BrowseConnectors — Disconnect destroys, the toggle does not (DEFECT 1)', () => {
  it('Disconnect asks for a destructive disconnect', async () => {
    connectGithub();
    render(<BrowseConnectors />);

    fireEvent.click(await screen.findByTitle('Disconnect'));

    await waitFor(() => expect(provisionCalls('DELETE')).toHaveLength(1));
    expect(String(provisionCalls('DELETE')[0][0])).toContain('intent=disconnect');
    expect(String(provisionCalls('DELETE')[0][0])).toContain('connectorId=github');
  });

  it('the on/off toggle asks for a reversible disable and keeps the credential', async () => {
    connectGithub();
    render(<BrowseConnectors />);

    fireEvent.click(await screen.findByTitle('Disable'));

    await waitFor(() => expect(provisionCalls('DELETE')).toHaveLength(1));
    const requested = String(provisionCalls('DELETE')[0][0]);
    expect(requested).toContain('intent=disable');
    expect(requested).not.toContain('intent=disconnect');
    // Still authenticated — only switched off, so it can be switched back on.
    expect(useConnectorStore.getState().connectorStates['github']?.authenticated).toBe(true);
    expect(useConnectorStore.getState().tokens['github']).toBe('ghp_real');
  });

  it('Disconnect also revokes the grant upstream', async () => {
    connectGithub();
    render(<BrowseConnectors />);

    fireEvent.click(await screen.findByTitle('Disconnect'));
    await waitFor(() => expect(callsTo('/api/connectors/revoke')).toHaveLength(1));
  });
});

describe('BrowseConnectors — re-enable never invents a credential (DEFECT 1b)', () => {
  it('does not POST the hydrate sentinel as the token', async () => {
    // A store persisted by an older build still carries the sentinel.
    connectGithub('provisioned');
    useConnectorStore.setState({
      connectorStates: { github: { id: 'github', enabled: false, authenticated: true } },
    } as never);
    render(<BrowseConnectors />);

    fireEvent.click(await screen.findByTitle('Enable'));

    await waitFor(() => expect(provisionCalls('POST')).toHaveLength(1));
    const sent = JSON.parse((provisionCalls('POST')[0][1] as RequestInit).body as string);
    expect(sent.token).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain('provisioned');
  });

  it('sends the real credential back when the client actually holds one', async () => {
    connectGithub('ghp_real');
    useConnectorStore.setState({
      connectorStates: { github: { id: 'github', enabled: false, authenticated: true } },
    } as never);
    render(<BrowseConnectors />);

    fireEvent.click(await screen.findByTitle('Enable'));

    await waitFor(() => expect(provisionCalls('POST')).toHaveLength(1));
    const sent = JSON.parse((provisionCalls('POST')[0][1] as RequestInit).body as string);
    expect(sent.token).toBe('ghp_real');
  });

  it('hydration marks a provisioned connector connected without storing a fake token', async () => {
    serve({ hydrate: ['github'], reports: [healthy('github')] });
    render(<BrowseConnectors />);

    await waitFor(() =>
      expect(useConnectorStore.getState().connectorStates['github']?.authenticated).toBe(true),
    );
    expect(useConnectorStore.getState().tokens['github']).toBeUndefined();
  });
});

describe('BrowseConnectors — a provisioned catalogue server reads as connected (DEFECT 3)', () => {
  /** The catalogue row for a service, whatever it currently says. */
  const catalogRow = (name: string) => {
    const heading = screen.getByText(name);
    const row = heading.closest('div.rounded-lg');
    if (!row) throw new Error(`no catalogue row for ${name}`);
    return row;
  };

  it('reads Connected when the provisioned config says so, even though its id is not in CONNECTOR_MAP', async () => {
    serve({ hydrate: [], reports: [healthy('linear')] });
    render(<BrowseConnectors />);

    await waitFor(() => expect(catalogRow('Linear').textContent).toContain('Connected'));
    expect(catalogRow('Linear').querySelector('button')).toBeNull();
  });

  it('still reads Connected after a remount — nothing depends on this session’s memory', async () => {
    serve({ hydrate: [], reports: [healthy('linear')] });
    const first = render(<BrowseConnectors />);
    await waitFor(() => expect(catalogRow('Linear').textContent).toContain('Connected'));

    // The bug that shipped: `justConnected` is local state, so it survived only
    // until the screen was closed.
    first.unmount();
    render(<BrowseConnectors />);
    await waitFor(() => expect(catalogRow('Linear').textContent).toContain('Connected'));
  });

  it('a catalogue service nobody connected still offers Connect', async () => {
    serve({ hydrate: [], reports: [healthy('linear')] });
    render(<BrowseConnectors />);

    await waitFor(() => expect(catalogRow('Linear').textContent).toContain('Connected'));
    expect(catalogRow('Notion').textContent).toContain('Connect');
    expect(catalogRow('Notion').textContent).not.toContain('Connected');
  });

  it('reads the drift report the server already sends — provisioned-but-unknown counts as connected', async () => {
    // `missingInClient` is exactly "provisioned on disk, the UI thinks it is
    // disconnected". It was computed, sent over HTTP and never read.
    serve({
      hydrate: [],
      reports: [],
      drift: { missingInClient: ['notion'], missingOnDisk: [] },
    });
    render(<BrowseConnectors />);

    await waitFor(() => expect(catalogRow('Notion').textContent).toContain('Connected'));
  });
});

describe('BrowseConnectors — drift the other way is surfaced, not swallowed', () => {
  it('warns when a service shows as connected but nothing is provisioned for the agent', async () => {
    connectGithub();
    serve({
      hydrate: [],
      reports: [],
      drift: { missingInClient: [], missingOnDisk: ['github'] },
    });
    render(<BrowseConnectors />);

    const notice = await screen.findByText(/not provisioned for the agent/i);
    expect(notice.textContent).toContain('GitHub');
  });

  it('says nothing about a connector the user merely switched off', async () => {
    // A disabled entry is stashed out of `mcpServers` on purpose, so it shows up
    // as missing on disk. That is the toggle working, not a dead connection.
    useConnectorStore.setState({
      tokens: { github: 'ghp_real' },
      connectorStates: { github: { id: 'github', enabled: false, authenticated: true } },
    } as never);
    serve({
      hydrate: [],
      reports: [],
      drift: { missingInClient: [], missingOnDisk: ['github'] },
    });
    render(<BrowseConnectors />);

    await screen.findByText('GitHub');
    await waitFor(() => expect(callsTo('/api/connectors/health').length).toBeGreaterThan(0));
    expect(screen.queryByText(/not provisioned for the agent/i)).toBeNull();
  });
});
