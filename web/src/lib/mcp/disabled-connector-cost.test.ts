import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * What a switched-off connector COSTS on every message (P3.5, measured).
 *
 * Two mechanisms for "off" existed in parallel and only the expensive one was
 * wired to the UI:
 *
 *   CLIENT-SIDE DENY LIST — the entry stays in `config.mcpServers`, so
 *     `loadProvisionedMcpServers` pays for it in full (credential decrypt,
 *     injectSecrets, its share of applyToolPolicies, and — inside the 5-minute
 *     refresh buffer — an outbound OAuth token-refresh POST plus a config rewrite),
 *     and `filterMcpServers` then discards the result at the chat route.
 *
 *   SERVER-SIDE STASH — `/api/connectors/provision?intent=disable` moves the entry
 *     to `config.disabledMcpServers`. The loader reads only `config.mcpServers`, so
 *     the server is never touched at all.
 *
 * Everything here is real: a real AES-256-GCM store with a real master key, a real
 * config file, a real refresh-eligible entry. Only `fetch` and the path resolver
 * are stubbed, and `fetch` is stubbed precisely so the refresh POST is COUNTABLE.
 */

let dir: string;
let configPath: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => configPath,
  getDataDir: () => dir,
}));

/** Every `get` is one full decrypt of the whole credential blob. Real store beneath. */
let storeGets: string[] = [];

vi.mock('./secret-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./secret-store')>();
  return {
    ...actual,
    getMcpSecretStore: () => {
      const real = actual.getMcpSecretStore();
      return {
        ...real,
        get: (key: string) => {
          storeGets.push(key);
          return real.get(key);
        },
      };
    },
  };
});

const fetchMock = vi.fn();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-disabled-cost-'));
  configPath = join(dir, '.aime-mcp.json');
  process.env.AIME_CRED_KEY = randomBytes(32).toString('hex');
  storeGets = [];
  fetchMock.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ access_token: 'ROTATED', expires_in: 3600 }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  delete process.env.AIME_CRED_KEY;
  vi.unstubAllGlobals();
  vi.resetModules();
  await rm(dir, { recursive: true, force: true });
});

/**
 * A connector inside the 5-minute refresh buffer, so the load triggers the full
 * expensive path: decrypt, refresh POST, config rewrite, re-encrypt.
 */
const nearExpiry = () => ({
  transport: 'stdio',
  command: 'node',
  args: ['/opt/mcp/google.mjs'],
  env: { GOOGLE_ACCESS_TOKEN: '${AIME_SECRET}' },
  _meta: {
    connectorId: 'google-personal',
    expiresAt: Date.now() + 60_000, // inside REFRESH_BUFFER_MS
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    clientId: 'cid',
  },
});

/** A second, healthy connector so "nothing at all happens" is distinguishable. */
const healthy = () => ({
  transport: 'streamable-http',
  url: 'https://api.githubcopilot.com/mcp/',
  headers: { Authorization: 'Bearer ${AIME_SECRET}' },
  _meta: { connectorId: 'github' },
});

const seedStore = async () => {
  const { getMcpSecretStore } = await import('./secret-store');
  const store = getMcpSecretStore();
  await store.set('aime-connector-google-personal', {
    env: { GOOGLE_ACCESS_TOKEN: 'ya29.live' },
    refreshToken: '1//rt',
  });
  await store.set('aime-connector-github', { headers: { Authorization: 'ghp_live' } });
  storeGets = []; // the seeding itself must not be counted
};

const load = async () => {
  const { loadProvisionedMcpServers } = await import('./provisioned');
  return (await loadProvisionedMcpServers()) as Record<string, unknown>;
};

const refreshPosts = () =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

describe('cost of a disabled connector — client deny list vs server stash', () => {
  it('BEFORE: a deny-listed connector still costs a decrypt, a refresh POST and a config rewrite', async () => {
    // The shape the client-side deny list leaves on disk: still mounted, dropped
    // later by filterMcpServers at the chat route.
    await writeFile(configPath, JSON.stringify({ mcpServers: { 'aime-connector-google-personal': nearExpiry(), 'aime-connector-github': healthy() } }), { mode: 0o600 });
    await seedStore();
    const before = await readFile(configPath, 'utf-8');

    const servers = await load();

    // It was loaded in full…
    expect(Object.keys(servers).sort()).toEqual(['aime-connector-github', 'aime-connector-google-personal']);
    expect(storeGets.filter((k) => k === 'aime-connector-google-personal').length).toBeGreaterThanOrEqual(1);
    expect(refreshPosts()).toHaveLength(1);
    expect(refreshPosts()[0][0]).toBe('https://oauth2.googleapis.com/token');
    // …and the file was rewritten, on a request whose answer is "don't mount it":
    // the deny list ran on the RESULT of all this, at the chat route, and threw
    // `aime-connector-google-personal` away.
    expect(await readFile(configPath, 'utf-8')).not.toBe(before);
  });

  it('AFTER: the same connector in disabledMcpServers costs nothing at all', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: { 'aime-connector-github': healthy() },
        disabledMcpServers: { 'aime-connector-google-personal': nearExpiry() },
      }),
      { mode: 0o600 },
    );
    await seedStore();

    const servers = await load();

    expect(Object.keys(servers)).toEqual(['aime-connector-github']);
    // Zero decrypts and zero network for the disabled one. The healthy connector
    // is still paid for, which is what proves the counters are live.
    expect(storeGets).not.toContain('aime-connector-google-personal');
    expect(storeGets).toContain('aime-connector-github');
    expect(refreshPosts()).toEqual([]);
  });

  it('AFTER: a stashed entry keeps everything needed to switch back on', async () => {
    // The saving must not come from having thrown the credential away.
    await writeFile(
      configPath,
      JSON.stringify({ disabledMcpServers: { 'aime-connector-google-personal': nearExpiry() } }),
      { mode: 0o600 },
    );
    await seedStore();
    await load();

    const stash = JSON.parse(await readFile(configPath, 'utf-8')).disabledMcpServers;
    expect(stash['aime-connector-google-personal']._meta.tokenEndpoint).toBe(
      'https://oauth2.googleapis.com/token',
    );
    const { getMcpSecretStore } = await import('./secret-store');
    expect((await getMcpSecretStore().get('aime-connector-google-personal'))?.refreshToken).toBe('1//rt');
  });
});

/**
 * The other half of the same measurement (TASK 5): what the LOADER pays per
 * message, and for what.
 *
 * `connectors/health.ts` fixed exactly this on its side and said so in
 * `mergedMetadata`: "one store.get() per server IN THE CONFIG — each of which is a
 * full AES-256-GCM decrypt of the entire credential blob — including for the user's
 * own playwright/hand-written entries". The loader still did it, sequentially, on
 * the path that runs for every message.
 */
describe('cost of loading — a decrypt only for entries that need one', () => {
  /** No sentinel anywhere: nothing for injectSecrets to put back. */
  const userOwnServer = () => ({ command: 'npx', args: ['-y', 'playwright-mcp'] });
  const ambientStdio = () => ({
    transport: 'stdio',
    command: 'node',
    args: ['/opt/aws.mjs'],
    _meta: { connectorId: 'aws' },
  });

  it('REGRESSION: does not decrypt the whole credential store for entries carrying no secret', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          playwright: userOwnServer(),
          'aime-connector-aws': ambientStdio(),
          'aime-connector-github': healthy(),
        },
      }),
      { mode: 0o600 },
    );
    await seedStore();

    await load();

    // Only the github entry carries `Bearer ${AIME_SECRET}`.
    expect(storeGets).toEqual(['aime-connector-github']);
  });

  it('still looks up one of the user\'s OWN entries once its secret has been migrated', async () => {
    // migrateInlineSecrets lifts secrets out of every entry, not just managed ones,
    // so "not ours" is the wrong test for "needs no lookup" — the sentinel is.
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: { playwright: { ...userOwnServer(), env: { PW_TOKEN: 'inline-secret' } } },
      }),
      { mode: 0o600 },
    );

    const servers = (await load()) as Record<string, { env?: Record<string, string> }>;

    // Migrated on this same pass, then read back and mounted with the real value.
    expect(storeGets).toContain('playwright');
    expect(servers.playwright.env).toEqual({ PW_TOKEN: 'inline-secret' });
    expect(await readFile(configPath, 'utf-8')).not.toContain('inline-secret');
  });

  it('still drops an entry whose sentinel cannot be resolved', async () => {
    // The saving must not turn into "mount it with the placeholder", which would
    // send `Bearer ${AIME_SECRET}` to the service as the credential.
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { 'aime-connector-github': healthy() } }),
      { mode: 0o600 },
    );
    // Nothing seeded: the store has no record for it.
    expect(Object.keys(await load())).toEqual([]);
  });
});

describe('cost of loading — the refresh scan does not decrypt to learn there is nothing to do', () => {
  /** A live OAuth token with fifty minutes left: the overwhelmingly common case. */
  const comfortablyValid = () => ({
    transport: 'streamable-http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer ${AIME_SECRET}' },
    _meta: { connectorId: 'github', expiresAt: Date.now() + 50 * 60_000, tokenEndpoint: 'https://x/t', clientId: 'c' },
  });
  /** A PAT or ambient IAM credential: no expiry, so nothing can ever age out. */
  const neverExpires = () => ({
    transport: 'stdio',
    command: 'node',
    args: ['/opt/aws.mjs'],
    _meta: { connectorId: 'aws' },
  });

  it('REGRESSION: reads the store once per entry that NEEDS a refresh, not once per entry', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          'aime-connector-github': comfortablyValid(),
          'aime-connector-aws': neverExpires(),
          'aime-connector-google-personal': nearExpiry(),
        },
      }),
      { mode: 0o600 },
    );
    await seedStore();

    await load();

    // google-personal is inside the buffer, so it is read (twice: once by the
    // refresh scan, once to inject the rotated credential). github is read only for
    // injection. aws carries no sentinel and no expiry, so it is never read at all.
    expect(storeGets).not.toContain('aime-connector-aws');
    expect(storeGets.filter((k) => k === 'aime-connector-github')).toHaveLength(1);
    expect(refreshPosts()).toHaveLength(1);
  });

  it('still refreshes a token that IS inside the buffer', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { 'aime-connector-google-personal': nearExpiry() } }),
      { mode: 0o600 },
    );
    await seedStore();

    await load();

    expect(refreshPosts()).toHaveLength(1);
    expect(refreshPosts()[0][0]).toBe('https://oauth2.googleapis.com/token');
  });

  it('still refreshes a token whose expiry is corrupt rather than silently skipping it', async () => {
    // The pre-screen must preserve the old semantics exactly: `expiresAt` present
    // but not a number fell THROUGH the buffer check and attempted a refresh.
    const corrupt = { ...nearExpiry(), _meta: { ...nearExpiry()._meta, expiresAt: 'soon' } };
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { 'aime-connector-google-personal': corrupt } }),
      { mode: 0o600 },
    );
    await seedStore();

    await load();
    expect(refreshPosts()).toHaveLength(1);
  });
});
