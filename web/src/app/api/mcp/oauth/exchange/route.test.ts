import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The claim under test: the code and our client secret go to the endpoint we
 * DISCOVERED at registration, not to whatever the request says. So the assertion
 * is on the URL actually fetched — checking only the response would pass even if
 * the fix were inert, which is exactly the bug I introduced writing it.
 */

let dir: string;
let configPath: string;
let clientsPath: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => configPath,
  getMcpClientsPath: () => clientsPath,
}));

const fetchMock = vi.fn();
const fetchedUrls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-exchange-'));
  configPath = join(dir, '.mcp.json');
  clientsPath = join(dir, '.clients.json');
  fetchMock.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), {
      status: 200,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

const registerClient = (over: Record<string, unknown> = {}) =>
  writeFile(
    clientsPath,
    JSON.stringify({
      acme: {
        clientId: 'cid',
        clientSecret: 'csecret',
        mcpUrl: 'https://mcp.acme.com/mcp',
        tokenEndpoint: 'https://auth.acme.com/token',
        ...over,
      },
    }),
    { mode: 0o600 },
  );

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new Request('http://localhost/api/mcp/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
};

const validBody = (over: Record<string, unknown> = {}) => ({
  mcpName: 'acme',
  code: 'authcode',
  codeVerifier: 'verifier',
  redirectUri: 'http://localhost:3000/cb',
  tokenEndpoint: 'https://auth.acme.com/token',
  clientId: 'cid',
  ...over,
});

describe('POST /api/mcp/oauth/exchange — token endpoint trust', () => {
  it('POSTs the code to the DISCOVERED endpoint, not the one in the request', async () => {
    await registerClient();
    const res = await post(validBody({ tokenEndpoint: 'https://evil.example/collect' }));

    expect(res.status).toBe(200);
    expect(fetchedUrls()).toEqual(['https://auth.acme.com/token']);
    expect(fetchedUrls()[0]).not.toContain('evil.example');
  });

  it('does not leak the client secret to an attacker endpoint', async () => {
    await registerClient();
    await post(validBody({ tokenEndpoint: 'https://evil.example/collect' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://auth.acme.com/token');
    expect(String((init as RequestInit).body)).toContain('client_secret=csecret');
  });

  it('records the discovered endpoint for refresh, not the requested one', async () => {
    await registerClient();
    await post(validBody({ tokenEndpoint: 'https://evil.example/collect' }));

    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    const meta = config.mcpServers['aime-mcp-acme']._meta;
    expect(meta.tokenEndpoint).toBe('https://auth.acme.com/token');
  });

  it('falls back to the request when nothing was stored, but still demands https', async () => {
    // A pre-existing registration written before tokenEndpoint was persisted.
    await registerClient({ tokenEndpoint: undefined });
    const ok = await post(validBody({ tokenEndpoint: 'https://auth.acme.com/token' }));
    expect(ok.status).toBe(200);

    fetchMock.mockClear();
    const bad = await post(validBody({ tokenEndpoint: 'http://auth.acme.com/token' }));
    expect(bad.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-URL endpoint without fetching', async () => {
    await registerClient({ tokenEndpoint: undefined });
    const res = await post(validBody({ tokenEndpoint: 'not a url' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/mcp/oauth/exchange — basics', () => {
  it('requires the core fields', async () => {
    await registerClient();
    expect((await post(validBody({ code: undefined }))).status).toBe(400);
    expect((await post(validBody({ mcpName: undefined }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when no MCP URL was registered', async () => {
    await writeFile(clientsPath, JSON.stringify({ acme: { clientId: 'cid' } }), { mode: 0o600 });
    const res = await post(validBody());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No MCP URL/);
  });

  it('writes the provisioned entry owner-only — it holds a live bearer token', async () => {
    await registerClient();
    await post(validBody());
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
  });

  it('provisions with the bearer header and the registered URL', async () => {
    await registerClient();
    await post(validBody());

    const entry = JSON.parse(await readFile(configPath, 'utf-8')).mcpServers['aime-mcp-acme'];
    expect(entry.url).toBe('https://mcp.acme.com/mcp');
    expect(entry.headers.Authorization).toBe('Bearer AT');
    expect(entry.transport).toBe('streamable-http');
  });

  it('uses the legacy sse transport only for /sse URLs', async () => {
    await registerClient({ mcpUrl: 'https://mcp.acme.com/sse' });
    await post(validBody());
    const entry = JSON.parse(await readFile(configPath, 'utf-8')).mcpServers['aime-mcp-acme'];
    expect(entry.transport).toBe('sse');
  });

  it('surfaces an upstream rejection as a 502 rather than claiming success', async () => {
    await registerClient();
    fetchMock.mockResolvedValue(new Response('invalid_grant', { status: 400 }));
    const res = await post(validBody());
    expect(res.status).toBe(502);
  });
});

/**
 * Exchange writes the key `aime-mcp-<mcpName>`, which consumers map back to a
 * built-in connector id. Setup refuses an impostor name, but a clients file
 * written by an older build (or by hand) can still carry one, so the last step
 * before provisioning checks it too.
 */
describe('POST /api/mcp/oauth/exchange — a name cannot claim a built-in connector', () => {
  it('refuses to provision aime-mcp-github for a lookalike origin', async () => {
    await writeFile(
      clientsPath,
      JSON.stringify({
        github: {
          clientId: 'cid',
          mcpUrl: 'https://mcp.github.evil.com/mcp',
          tokenEndpoint: 'https://auth.evil.com/token',
        },
      }),
      { mode: 0o600 },
    );
    const res = await post(validBody({ mcpName: 'github' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(readFile(configPath, 'utf-8')).rejects.toThrow();
  });

  it('still provisions a built-in name on its real origin', async () => {
    await writeFile(
      clientsPath,
      JSON.stringify({
        atlassian: {
          clientId: 'cid',
          mcpUrl: 'https://mcp.atlassian.com/v1/mcp',
          tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
        },
      }),
      { mode: 0o600 },
    );
    const res = await post(validBody({ mcpName: 'atlassian' }));
    expect(res.status).toBe(200);
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(config.mcpServers['aime-mcp-atlassian'].url).toBe('https://mcp.atlassian.com/v1/mcp');
  });
});
