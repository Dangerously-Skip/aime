import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
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

/**
 * The reuse branch returned `clients[mcpName]` without ever comparing the stored
 * URL to the one just asked for. Two unrelated vendors derive the same name
 * (mcp.acme.com and acme.io both → `acme`), so the second one silently got the
 * FIRST one's authorization endpoint and client_id: the user was shown vendor
 * A's consent screen, granted A a fresh token, and was told "Connected acme".
 * B was never contacted and no error was shown.
 */
describe('POST /api/mcp/oauth/setup — reuse is per origin, not per name', () => {
  const clientsPath = () => join(dir, '.clients.json');

  const registerVendorA = () =>
    writeFile(
      clientsPath(),
      JSON.stringify({
        acme: {
          clientId: 'client-id-of-vendor-A',
          clientSecret: 'secret-A',
          authorizationEndpoint: 'https://auth.acme.com/authorize',
          tokenEndpoint: 'https://auth.acme.com/token',
          scopes: ['a'],
          mcpUrl: 'https://mcp.acme.com/mcp',
          redirectUri: 'http://localhost:3000/api/connectors/oauth/callback',
          registeredAt: 1,
        },
      }),
      { mode: 0o600 },
    );

  it('reuses the registration when the origin is the same', async () => {
    await registerVendorA();
    // A different path on the same origin is the same server.
    const res = await post({ mcpName: 'acme', mcpUrl: 'https://mcp.acme.com/sse' });
    expect(res.status).toBe(200);
    expect((await res.json()).clientId).toBe('client-id-of-vendor-A');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never hands vendor A’s registration to a request for vendor B', async () => {
    await registerVendorA();
    const res = await post({ mcpName: 'acme', mcpUrl: 'https://acme.io/mcp' });

    const body = await res.text();
    expect(res.status).toBe(409);
    // Not A's client_id, not A's consent screen.
    expect(body).not.toContain('client-id-of-vendor-A');
    expect(body).not.toContain('auth.acme.com');
    expect(body).toMatch(/already/i);
  });

  it('does not overwrite the existing registration on a mismatch', async () => {
    await registerVendorA();
    await post({ mcpName: 'acme', mcpUrl: 'https://acme.io/mcp' });

    const stored = JSON.parse(await readFile(clientsPath(), 'utf-8'));
    expect(Object.keys(stored)).toEqual(['acme']);
    expect(stored.acme.clientId).toBe('client-id-of-vendor-A');
    expect(stored.acme.mcpUrl).toBe('https://mcp.acme.com/mcp');
  });

  it('does not even contact the second vendor — the name is settled first', async () => {
    await registerVendorA();
    await post({ mcpName: 'acme', mcpUrl: 'https://acme.io/mcp' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a different port as a different origin', async () => {
    await registerVendorA();
    const res = await post({ mcpName: 'acme', mcpUrl: 'https://mcp.acme.com:8443/mcp' });
    expect(res.status).toBe(409);
  });

  it('re-registers when the stored entry never recorded a URL', async () => {
    // A registration written before mcpUrl was persisted has nothing to compare,
    // so it cannot be vouched for either — discovery runs again.
    await writeFile(clientsPath(), JSON.stringify({ acme: { clientId: 'old' } }), { mode: 0o600 });
    const res = await post({ mcpName: 'acme', mcpUrl: 'https://mcp.acme.com/mcp' });
    expect(res.status).not.toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });
});

/**
 * `mcpName` becomes the config key `aime-mcp-<name>`, which consumers map back to
 * a built-in connector id. So the name is an identity claim and the server has to
 * check it, not just the UI.
 */
describe('POST /api/mcp/oauth/setup — a name cannot claim a built-in connector', () => {
  const impostors: Array<[string, string]> = [
    ['github', 'https://mcp.github.evil.com/mcp'],
    ['slack', 'https://api.slack.attacker.net/mcp'],
    ['notion', 'https://mcp.notion.com.evil.io/mcp'],
    ['atlassian', 'https://www.atlassian.badguy.dev/mcp'],
  ];

  it.each(impostors)('refuses %s pointed at %s, without fetching', async (mcpName, mcpUrl) => {
    const res = await post({ mcpName, mcpUrl });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/built-in|reserved|belongs/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets the real vendor origin through to discovery', async () => {
    await post({ mcpName: 'atlassian', mcpUrl: 'https://mcp.atlassian.com/v1/mcp' });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('lets a Microsoft connector through once its tenant is substituted', async () => {
    await post({
      mcpName: 'outlook-mail',
      mcpUrl:
        'https://agent365.svc.cloud.microsoft/agents/tenants/tenant-abc/servers/mcp_MailTools',
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('leaves ordinary third-party names untouched', async () => {
    await post({ mcpName: 'acme', mcpUrl: 'https://mcp.acme.com/mcp' });
    expect(fetchMock).toHaveBeenCalled();
  });
});
