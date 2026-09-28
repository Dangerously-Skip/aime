// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AgentsPanel } from './agents-panel';
import { ConnectorDetail } from './connector-detail';
import { SkillDetail } from './skill-detail';
import { PluginRow } from './plugin-row';
import { MCP_CONFIG_FILENAME } from '@/config/branding';

/**
 * Small review findings on the Customize screens, each pinned so it stays
 * fixed. Only fetch is stubbed.
 */

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

let agents: Array<Record<string, unknown>> = [];
let plugins: Array<Record<string, unknown>> = [];

beforeEach(() => {
  agents = [];
  plugins = [];
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/agents')) return json({ agents });
    if (u.includes('/api/marketplace')) return json({ plugins });
    return json({});
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Agents', () => {
  it('shows exactly one "New agent" action when there are no agents', async () => {
    render(<AgentsPanel />);
    await screen.findByText(/No agents defined/);
    expect(screen.getAllByRole('button', { name: /New agent/ })).toHaveLength(1);
  });

  it('shows exactly one when there are agents', async () => {
    agents = [{ name: 'researcher', description: 'Finds things', scope: 'user', prompt: '' }];
    render(<AgentsPanel />);
    await screen.findByText('researcher');
    expect(screen.getAllByRole('button', { name: /New agent/ })).toHaveLength(1);
  });
});

describe('Connectors empty state', () => {
  it('keeps the config path on one line, with the full path on hover', () => {
    render(<ConnectorDetail connectorId={null} />);
    const code = screen.getByText(`~/.claude/${MCP_CONFIG_FILENAME}`);
    expect(code.className).toContain('whitespace-nowrap');
    expect(code.getAttribute('title')).toBe(`~/.claude/${MCP_CONFIG_FILENAME}`);
  });

  it('has a single "Browse connectors" button', () => {
    render(<ConnectorDetail connectorId={null} />);
    expect(screen.getAllByRole('button', { name: /Browse connectors/ })).toHaveLength(1);
  });
});

describe('Skills empty state', () => {
  it('does not present Marketplace integrations as skills', async () => {
    plugins = [{ name: 'asana', description: 'Tasks', source: './asana', category: 'productivity' }];
    render(<SkillDetail skillId={null} />);
    expect(await screen.findByText('Related plugins')).toBeTruthy();
    expect(screen.queryByText('From the Marketplace')).toBeNull();
  });
});

describe('PluginRow', () => {
  it('aligns its text left even inside a centred empty state', () => {
    const { container } = render(
      <div className="text-center">
        <PluginRow plugin={{ name: 'figma', description: 'Design', source: './figma' }} compact />
      </div>,
    );
    expect((container.firstChild!.firstChild as HTMLElement).className).toContain('text-left');
  });
});
