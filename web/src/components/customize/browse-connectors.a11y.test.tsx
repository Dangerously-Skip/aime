// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { BrowseConnectors } from './browse-connectors';
import { PluginRow } from './plugin-row';
import { useConnectorStore } from '@/stores/connector-store';

/**
 * The connector card's controls are operable and announced without a mouse.
 *
 * The on/off toggle was a bare <button> whose state was only its colour, and
 * Disconnect/Uninstall were `opacity-0 group-hover:opacity-100` — present in
 * the tab order but invisible when focused, so a keyboard user tabbed onto a
 * destructive button they could not see.
 */

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/connectors/health')) return json({ connectors: [], needsReconnect: [] });
    if (u.includes('/api/connectors/hydrate')) return json({ connectedIds: [] });
    return json({ plugins: [], success: true });
  }));
  useConnectorStore.setState({
    tokens: { github: 'ghp_real' },
    tokenMeta: {},
    oauthClientCreds: {},
    connectorStates: { github: { id: 'github', enabled: true, authenticated: true } },
  } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('connector on/off toggle', () => {
  it('is a named switch that reports its state', async () => {
    render(<BrowseConnectors />);
    const sw = await screen.findByRole('switch', { name: 'Use GitHub' });
    expect(sw.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(sw);

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Use GitHub' }).getAttribute('aria-checked')).toBe('false'),
    );
  });
});

describe('hover-revealed actions', () => {
  it('Disconnect becomes visible on keyboard focus', async () => {
    render(<BrowseConnectors />);
    const btn = await screen.findByRole('button', { name: 'Disconnect GitHub' });
    expect(btn.className).toContain('opacity-0');
    expect(btn.className).toContain('focus-visible:opacity-100');
  });

  it('Uninstall on an installed plugin is named and focus-visible', () => {
    render(
      <PluginRow
        plugin={{ name: 'figma', description: 'Design', source: './figma' }}
        installedState={{ installed: true, authenticated: false, hasMcpOAuth: false }}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Uninstall figma' });
    expect(btn.className).toContain('focus-visible:opacity-100');
  });
});

describe('icon-only header buttons', () => {
  it('the Connectors back arrow is named', async () => {
    render(<BrowseConnectors />);
    expect(await screen.findByRole('button', { name: 'Back to Connectors' })).toBeTruthy();
  });
});
