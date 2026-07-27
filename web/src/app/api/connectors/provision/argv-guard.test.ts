import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * A credential must never reach `args`, and the route must refuse rather than
 * write it (DR-14 / TASK 3).
 *
 * `env` and `headers` are split into the encrypted store. `args` is not, and
 * cannot usefully be: the SDK serialises `mcpServers` into the `claude` CLI argv,
 * so an "encrypted" argv secret would still be readable in `ps auxww` — the exact
 * exposure `injectSecrets` refuses to reintroduce for `_meta.refreshToken`.
 *
 * The path is unreachable through the real registry today (`tokenInjection`
 * supports only `env` and `header`, and args are static), so the registry entry is
 * substituted here. That is the point of the guard: it exists to fire the day
 * someone adds an entry like this, and this test is what proves it would.
 */

let dir: string;
let configPath: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => configPath,
  getDataDir: () => dir,
}));

/**
 * The REAL registry with one connector's args rewritten. Everything else — the
 * guard in provision-guard, the secret store, the file write — runs for real, and
 * both `@/lib/connectors/registry` and provision-guard's `./registry` resolve to
 * this same module, so the route and its validator see the same definition.
 */
vi.mock('@/lib/connectors/registry', async (orig) => {
  const actual = await orig<typeof import('@/lib/connectors/registry')>();
  const patch = (def: (typeof actual.CONNECTOR_REGISTRY)[number]) =>
    def.id === 'buildkite'
      ? { ...def, mcp: { ...def.mcp, args: ['-y', '@buildkite/mcp-server@latest', '--token=bkua_hardcoded_secret'] } }
      : def;
  const CONNECTOR_REGISTRY = actual.CONNECTOR_REGISTRY.map(patch);
  return {
    ...actual,
    CONNECTOR_REGISTRY,
    CONNECTOR_MAP: Object.fromEntries(CONNECTOR_REGISTRY.map((c) => [c.id, c])),
  };
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-argv-guard-'));
  configPath = join(dir, '.mcp.json');
  process.env.AIME_CRED_KEY = randomBytes(32).toString('hex');
});

afterEach(async () => {
  delete process.env.AIME_CRED_KEY;
  vi.resetModules();
  await rm(dir, { recursive: true, force: true });
});

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new Request('http://localhost/api/connectors/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
};

describe('POST /api/connectors/provision — a credential in argv is refused', () => {
  it('refuses the entry and writes NOTHING — not the config, not the store', async () => {
    const res = await post({ connectorId: 'buildkite', token: 'bkua_the_real_token' });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/command line/i);

    // No config file at all, so the agent cannot spawn it.
    await expect(stat(configPath)).rejects.toThrow();

    // And no credential parked in the encrypted store for a server that was refused.
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    expect(await getMcpSecretStore().get('aime-connector-buildkite')).toBeUndefined();
  });

  it('does not echo the credential back to the caller', async () => {
    const res = await post({ connectorId: 'buildkite', token: 'bkua_the_real_token' });
    const body = await res.text();
    expect(body).not.toContain('bkua_the_real_token');
    expect(body).not.toContain('bkua_hardcoded_secret');
  });

  it('leaves a previously provisioned entry untouched rather than half-updating it', async () => {
    // github is http and unpatched, so it provisions normally.
    expect((await post({ connectorId: 'github', token: 'ghp_fine' })).status).toBe(200);
    const before = await readFile(configPath, 'utf-8');

    expect((await post({ connectorId: 'buildkite', token: 'bkua_x' })).status).toBe(500);
    expect(await readFile(configPath, 'utf-8')).toBe(before);
  });

  it('still provisions connectors whose args carry no credential', async () => {
    // The same stdio shape, real registry args: a package spec and a path.
    const res = await post({ connectorId: 'google-personal', token: 'ya29.real' });
    expect(res.status).toBe(200);
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as {
      mcpServers: Record<string, { args?: string[] }>;
    };
    expect(config.mcpServers['aime-connector-google-personal'].args).toBeDefined();
  });
});
