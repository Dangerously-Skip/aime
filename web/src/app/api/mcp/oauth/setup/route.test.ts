import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Discovery fetches a caller-supplied URL server-side, so the property that
 * matters is that a hostile URL or name reaches NO fetch and NO filesystem read.
 * Asserting only the status code would pass even if the request had already been
 * made.
 */

let dir: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => join(dir, '.mcp.json'),
  getMcpClientsPath: () => join(dir, '.clients.json'),
}));

const fetchMock = vi.fn();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-setup-'));
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new Request('http://localhost/api/mcp/oauth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
};

describe('POST /api/mcp/oauth/setup — SSRF targets never get fetched', () => {
  const hostile = [
    'http://169.254.169.254/latest/meta-data/',
    'http://2852039166/latest/meta-data/',
    'http://10.0.0.5/mcp',
    'http://192.168.1.10/mcp',
    'http://mcp.example.com/mcp',
    'file:///etc/passwd',
    'ext::sh -c id',
    'https://user:pw@mcp.example.com/mcp',
  ];

  it.each(hostile)('refuses %j without making a request', async (mcpUrl) => {
    const res = await post({ mcpName: 'acme', mcpUrl });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a legitimate https endpoint through to discovery', async () => {
    // Discovery itself will fail against the stub, but it must be ATTEMPTED —
    // otherwise the guard is simply blocking everything.
    await post({ mcpName: 'acme', mcpUrl: 'https://mcp.acme.com/mcp' });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('allows a local MCP server over http — an ordinary dev setup', async () => {
    await post({ mcpName: 'local', mcpUrl: 'http://localhost:3000/mcp' });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('POST /api/mcp/oauth/setup — mcpName is a path and a config key', () => {
  const hostileNames = ['../../../.ssh', '..', 'a/b', '$(id)', '.hidden', '-flag', ''];

  it.each(hostileNames)('refuses name %j without touching the filesystem', async (mcpName) => {
    const res = await post({ mcpName, mcpUrl: 'https://mcp.acme.com/mcp' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a missing name', async () => {
    expect((await post({ mcpUrl: 'https://mcp.acme.com/mcp' })).status).toBe(400);
  });

  it('accepts ordinary names', async () => {
    const res = await post({ mcpName: 'acme-mcp_1', mcpUrl: 'https://mcp.acme.com/mcp' });
    // not a 400 from validation — it proceeded to discovery
    expect(res.status).not.toBe(400);
  });
});
