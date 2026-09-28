import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

/**
 * A real config file; only its location is mocked.
 *
 * REGRESSION: a parse error read as `{ mcpServers: {} }`, so after a torn write
 * the next "Add connector" saved a config holding only the new entry — every
 * other connector (and its tokens) gone.
 */
let dir: string;
let configPath: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => configPath,
}));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-customize-conn-'));
  configPath = join(dir, '.aime-mcp.json');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new NextRequest('http://localhost/api/customize/connectors', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
};

describe('POST /api/customize/connectors', () => {
  it('adds a server alongside the existing ones', async () => {
    await writeFile(configPath, JSON.stringify({ mcpServers: { github: { url: 'g' } } }));
    const res = await post({ name: 'mine', config: { type: 'stdio', command: 'node' } });
    expect(res.status).toBe(201);
    const servers = JSON.parse(await readFile(configPath, 'utf-8')).mcpServers;
    expect(Object.keys(servers).sort()).toEqual(['github', 'mine']);
  });

  it('refuses to write over a corrupt config and keeps its bytes', async () => {
    const torn = '{"mcpServers": {"github": {"url": "g"';
    await writeFile(configPath, torn);
    const res = await post({ name: 'mine', config: { type: 'stdio', command: 'node' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/could not be parsed/);
    const quarantined = (await readdir(dir)).filter((n) => n.includes('.corrupt-'));
    expect(quarantined).toHaveLength(1);
    expect(await readFile(join(dir, quarantined[0]), 'utf-8')).toBe(torn);
  });

  it('reports a duplicate name without writing', async () => {
    const before = JSON.stringify({ mcpServers: { mine: { command: 'x' } } });
    await writeFile(configPath, before);
    const res = await post({ name: 'mine', config: { type: 'stdio', command: 'node' } });
    expect(res.status).toBe(409);
    expect(await readFile(configPath, 'utf-8')).toBe(before);
  });

  it('rejects a name that would reach Object.prototype', async () => {
    const res = await post({ name: '__proto__', config: { type: 'stdio', command: 'node' } });
    expect(res.status).toBe(400);
  });
});
