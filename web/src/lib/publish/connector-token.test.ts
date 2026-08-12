import { describe, it, expect, vi } from 'vitest';
import { connectorAccessToken, serverKeysFor, type StoredSecrets } from './connector-token';
import { CONNECTOR_REGISTRY } from '@/lib/connectors/registry';

/**
 * Connectors store their token in whichever shape they declared: Google in
 * `env.GOOGLE_ACCESS_TOKEN`, OneDrive in an `Authorization` header. Reading one
 * shape and assuming the other makes a feature work for half the connectors and
 * silently fail for the rest — and "silently" here means the user is told their
 * connected account is not connected.
 */
const store = (entries: Record<string, StoredSecrets>) => ({
  read: vi.fn(async (k: string) => entries[k]),
});

const GOOGLE = { id: 'google-workspace', mcp: { transport: 'http' as const, tokenInjection: { method: 'env' as const, envVar: 'GOOGLE_ACCESS_TOKEN' } } };
const ONEDRIVE = { id: 'onedrive-sharepoint', mcp: { transport: 'http' as const, tokenInjection: { method: 'header' as const, headerName: 'Authorization', prefix: 'Bearer ' } } };

describe('connectorAccessToken', () => {
  it('reads an env-injected token', async () => {
    const s = store({ 'mcp:aime-connector-google-workspace': { env: { GOOGLE_ACCESS_TOKEN: 'ya29.tok' } } });
    expect(await connectorAccessToken(GOOGLE, s)).toBe('ya29.tok');
  });

  it('reads a header-injected token', async () => {
    const s = store({ 'mcp:aime-connector-onedrive-sharepoint': { headers: { Authorization: 'gr4ph' } } });
    expect(await connectorAccessToken(ONEDRIVE, s)).toBe('gr4ph');
  });

  it('strips a scheme prefix an older build may have stored', async () => {
    const s = store({ 'mcp:aime-connector-onedrive-sharepoint': { headers: { Authorization: 'Bearer gr4ph' } } });
    expect(await connectorAccessToken(ONEDRIVE, s)).toBe('gr4ph');
  });

  /*
   * The app was renamed. An install that connected before it still has `nib-`
   * entries, and a token under the old key is a connector the user believes is
   * connected — so failing to look there reads as "reconnect your account".
   */
  it('finds a token stored under a pre-rename key', async () => {
    const s = store({ 'mcp:nib-connector-google-workspace': { env: { GOOGLE_ACCESS_TOKEN: 'old' } } });
    expect(await connectorAccessToken(GOOGLE, s)).toBe('old');
  });

  it('returns null when nothing is stored', async () => {
    expect(await connectorAccessToken(GOOGLE, store({}))).toBeNull();
  });

  it('returns null rather than throwing when the store fails', async () => {
    const s = { read: vi.fn(async () => { throw new Error('keychain locked'); }) };
    await expect(connectorAccessToken(GOOGLE, s)).resolves.toBeNull();
  });

  it('ignores an empty or whitespace token', async () => {
    const s = store({ 'mcp:aime-connector-google-workspace': { env: { GOOGLE_ACCESS_TOKEN: '   ' } } });
    expect(await connectorAccessToken(GOOGLE, s)).toBeNull();
  });

  /* A connector with no tokenInjection (iCloud is in-process) has no token
   * here; fail closed rather than inventing one. */
  it('returns null for a connector that declares no injection', async () => {
    const s = store({ 'mcp:aime-connector-icloud': { env: { SOMETHING: 'x' } } });
    expect(await connectorAccessToken({ id: 'icloud' }, s)).toBeNull();
  });

  it('reads the DECLARATION, not a guess', async () => {
    // Token present under the header name, but this connector declares env —
    // the loose fallback still finds it, which is deliberate and asserted so a
    // future tightening is a decision rather than an accident.
    const s = store({ 'mcp:aime-connector-google-workspace': { headers: { Authorization: 'Bearer x' } } });
    expect(await connectorAccessToken(GOOGLE, s)).toBe('x');
  });
});

describe('serverKeysFor', () => {
  it('covers both app names and both entry prefixes', () => {
    expect(serverKeysFor('google-workspace')).toEqual([
      'aime-connector-google-workspace',
      'aime-mcp-google-workspace',
      'nib-connector-google-workspace',
      'nib-mcp-google-workspace',
    ]);
  });
});

/**
 * Derived from the registry so the publish targets cannot drift from what the
 * connectors actually declare — the scope in particular, since Drive upload
 * fails at request time with a scope error that reads like a bug.
 */
describe('the publish targets are backed by real connectors', () => {
  it.each(['google-workspace', 'google-personal'])('%s exists and asks for Drive', (id) => {
    const c = CONNECTOR_REGISTRY.find((x) => x.id === id);
    expect(c, `${id} is gone — the Drive publisher has no connector`).toBeDefined();
    expect(JSON.stringify(c), 'the drive scope was removed').toContain('auth/drive');
  });

  it('onedrive-sharepoint exists for the Microsoft path', () => {
    expect(CONNECTOR_REGISTRY.find((x) => x.id === 'onedrive-sharepoint')).toBeDefined();
  });
});
