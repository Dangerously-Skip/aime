// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { McpCatalogPicker } from './mcp-catalog-picker';
import { MCP_CATALOG, findCatalogServer } from '@/lib/mcp/catalog';

/**
 * The DCR flow is stubbed (it opens a browser window); the catalogue data is
 * real, so these assert that clicking an entry starts the flow against the
 * verified URL — not against something the component invented.
 */

const runMcpOAuthFlow = vi.fn();
vi.mock('@/lib/mcp/oauth-flow', () => ({
  runMcpOAuthFlow: (...a: unknown[]) => runMcpOAuthFlow(...a),
}));

const onConnected = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  runMcpOAuthFlow.mockResolvedValue({ accessToken: 'at', expiresIn: 3600 });
});
afterEach(cleanup);

const cardFor = (name: string) =>
  screen.getByText(name).closest('div.flex.items-start') as HTMLElement;

const connectButtonFor = (name: string) =>
  cardFor(name).querySelector('button') as HTMLButtonElement;

describe('McpCatalogPicker', () => {
  it('lists every catalogue service', () => {
    render(<McpCatalogPicker onConnected={onConnected} />);
    for (const server of MCP_CATALOG) {
      expect(screen.getByText(server.name), server.id).toBeTruthy();
    }
  });

  it('connects against the verified URL for that service', async () => {
    render(<McpCatalogPicker onConnected={onConnected} />);
    fireEvent.click(connectButtonFor('Linear'));

    const linear = findCatalogServer('linear')!;
    await waitFor(() =>
      expect(runMcpOAuthFlow).toHaveBeenCalledWith('linear', linear.url, {}),
    );
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('linear'));
    expect(await screen.findByText('Connected')).toBeTruthy();
  });

  it('shows already-connected services as connected without a button', () => {
    render(<McpCatalogPicker connectedIds={new Set(['notion'])} onConnected={onConnected} />);
    expect(cardFor('Notion').textContent).toContain('Connected');
    expect(cardFor('Notion').querySelector('button')).toBeNull();
  });

  it('warns on money-handling services before they are connected', () => {
    render(<McpCatalogPicker onConnected={onConnected} />);
    for (const name of ['Stripe', 'PayPal', 'Square']) {
      expect(cardFor(name).textContent, name).toContain('Can move money');
    }
    // and not on anything else
    expect(cardFor('Linear').textContent).not.toContain('Can move money');
  });

  it('surfaces a failure against that service only', async () => {
    runMcpOAuthFlow.mockRejectedValue(new Error('Discovery failed: 503'));
    render(<McpCatalogPicker onConnected={onConnected} />);
    fireEvent.click(connectButtonFor('Sentry'));

    expect(await screen.findByText(/Discovery failed: 503/)).toBeTruthy();
    expect(onConnected).not.toHaveBeenCalled();
    // other cards are unaffected
    expect(cardFor('Linear').textContent).not.toContain('Discovery failed');
  });

  it('explains a previously-verified service that stops supporting registration', async () => {
    // Blaming the user's input would be wrong — the vendor changed.
    runMcpOAuthFlow.mockRejectedValue(new Error('Server does not support Dynamic Client Registration'));
    render(<McpCatalogPicker onConnected={onConnected} />);
    fireEvent.click(connectButtonFor('Vercel'));

    expect(await screen.findByText(/no longer supports automatic registration/)).toBeTruthy();
  });

  it('treats a closed auth window as a silent cancellation', async () => {
    runMcpOAuthFlow.mockRejectedValue(new Error('OAuth flow was canceled'));
    render(<McpCatalogPicker onConnected={onConnected} />);
    fireEvent.click(connectButtonFor('Canva'));

    await waitFor(() => expect(runMcpOAuthFlow).toHaveBeenCalled());
    expect(screen.queryByText(/cancel/i)).toBeNull();
  });

  it('explains why known services are absent', () => {
    render(<McpCatalogPicker onConnected={onConnected} />);
    expect(screen.getByText(/Why isn't my service listed/)).toBeTruthy();
    // /HubSpot/ alone matches both the name span and its containing <li>.
    expect(screen.getAllByText('HubSpot').length).toBeGreaterThan(0);
    expect(screen.getByText(/no dynamic registration/)).toBeTruthy();
    expect(screen.getByText(/can still be added by URL/)).toBeTruthy();
  });

  it('will not silently reuse a registration held by another origin', async () => {
    // A catalogue entry's id IS its identity, so it cannot be renamed away from a
    // conflict. Refusing loudly is the only safe outcome: reusing would show the
    // consent screen of whatever else holds that name.
    runMcpOAuthFlow.mockRejectedValue(
      new Error(
        '“notion” is already connected to a different server (https://mcp.notion.com.evil.io). Disconnect it first, or add this one under another name.',
      ),
    );
    render(<McpCatalogPicker onConnected={onConnected} />);
    fireEvent.click(connectButtonFor('Notion'));

    expect(await screen.findByText(/already connected to a different server/)).toBeTruthy();
    expect(onConnected).not.toHaveBeenCalled();
    expect(cardFor('Notion').textContent).not.toContain('Connected');
  });

  it('disables other buttons while one connection is in flight', async () => {
    let release: (v: unknown) => void = () => {};
    runMcpOAuthFlow.mockImplementation(() => new Promise((r) => { release = r; }));
    render(<McpCatalogPicker onConnected={onConnected} />);

    fireEvent.click(connectButtonFor('Asana'));
    await waitFor(() => expect(connectButtonFor('Notion').disabled).toBe(true));

    release({ accessToken: 'at' });
    await waitFor(() => expect(connectButtonFor('Notion').disabled).toBe(false));
  });
});
