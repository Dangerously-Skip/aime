import { describe, it, expect } from 'vitest';
import {
  classifyConnectionHealth,
  classifyProvisioned,
  diffConnections,
  REFRESH_BUFFER_MS,
} from './health';

const NOW = 1_700_000_000_000;
const at = (offsetMs: number) => NOW + offsetMs;

describe('classifyConnectionHealth', () => {
  it('treats a credential with no expiry as healthy (PAT, ambient IAM)', () => {
    expect(classifyConnectionHealth({ connectorId: 'github' }, NOW)).toMatchObject({
      status: 'healthy',
      needsReconnect: false,
    });
  });

  it('is healthy well before expiry', () => {
    const h = classifyConnectionHealth({ expiresAt: at(60 * 60 * 1000), refreshToken: 'rt' }, NOW);
    expect(h.status).toBe('healthy');
    expect(h.expiresAt).toBe(at(60 * 60 * 1000));
  });

  it('is refreshable inside the buffer when a refresh token exists', () => {
    const h = classifyConnectionHealth(
      { expiresAt: at(REFRESH_BUFFER_MS - 1000), refreshToken: 'rt' },
      NOW,
    );
    expect(h).toMatchObject({ status: 'refreshable', needsReconnect: false });
    expect(h.detail).toMatch(/renew automatically/);
  });

  it('is still refreshable after lapsing, if it can renew', () => {
    const h = classifyConnectionHealth({ expiresAt: at(-60_000), refreshToken: 'rt' }, NOW);
    expect(h).toMatchObject({ status: 'refreshable', needsReconnect: false });
  });

  it('is EXPIRED and needs a reconnect when there is no refresh token', () => {
    // Exactly the pre-access_type=offline Google case: an hour-old token with
    // nothing able to renew it, which used to read as "Connected" forever.
    const h = classifyConnectionHealth({ connectorId: 'google-personal', expiresAt: at(-1000) }, NOW);
    expect(h).toMatchObject({ status: 'expired', needsReconnect: true });
    expect(h.detail).toMatch(/no refresh token/);
  });

  it('flags an imminent expiry with no refresh token as needing a reconnect', () => {
    const h = classifyConnectionHealth({ expiresAt: at(1000) }, NOW);
    expect(h.status).toBe('expired');
    expect(h.needsReconnect).toBe(true);
  });

  it('trusts a failed live probe over local reasoning', () => {
    // Revocation leaves our metadata untouched, so only the service can tell us.
    const h = classifyConnectionHealth(
      { expiresAt: at(60 * 60 * 1000), refreshToken: 'rt', lastProbeFailed: true },
      NOW,
    );
    expect(h).toMatchObject({ status: 'revoked', needsReconnect: true });
  });

  it('reports unknown for a provisioned entry with no metadata', () => {
    expect(classifyConnectionHealth(undefined, NOW)).toMatchObject({
      status: 'unknown',
      needsReconnect: false,
    });
  });

  it('ignores a nonsense expiresAt rather than declaring the connection dead', () => {
    for (const bad of [NaN, Infinity, undefined]) {
      expect(
        classifyConnectionHealth({ expiresAt: bad as unknown as number }, NOW).status,
        String(bad),
      ).toBe('healthy');
    }
  });
});

describe('classifyProvisioned', () => {
  it('classifies managed entries and skips ones we do not own', () => {
    const reports = classifyProvisioned(
      {
        'aime-connector-github': { _meta: { connectorId: 'github' } },
        'aime-mcp-atlassian': {
          url: 'https://mcp.atlassian.com/v1/mcp',
          _meta: { mcpName: 'atlassian', expiresAt: at(-1), refreshToken: 'rt' },
        },
        'aime-connector-google-personal': { _meta: { connectorId: 'google-personal', expiresAt: at(-1) } },
        // user's own server — not ours to judge
        'playwright': { _meta: {} },
      },
      NOW,
    );
    expect(reports.map((r) => r.id)).toEqual(['atlassian', 'github', 'google-personal']);
    expect(reports.find((r) => r.id === 'google-personal')!.health.needsReconnect).toBe(true);
    expect(reports.find((r) => r.id === 'atlassian')!.health.status).toBe('refreshable');
  });

  it('recognises legacy nib-* keys', () => {
    const reports = classifyProvisioned({ 'nib-connector-miro': { _meta: { connectorId: 'miro' } } }, NOW);
    expect(reports).toHaveLength(1);
    expect(reports[0].id).toBe('miro');
  });

  it('falls back to the key when metadata omits the id', () => {
    const reports = classifyProvisioned({ 'aime-connector-figma': {} }, NOW);
    expect(reports[0].id).toBe('figma');
    expect(reports[0].health.status).toBe('unknown');
  });

  it('handles an empty or absent config', () => {
    expect(classifyProvisioned({}, NOW)).toEqual([]);
    expect(classifyProvisioned(undefined, NOW)).toEqual([]);
  });
});

describe('classifyProvisioned — a name is not proof of identity', () => {
  it('REGRESSION: an impostor aime-mcp-github does not surface as the id `github`', () => {
    // Same origin check `connectedIdsFromServerKeys` applies: a server the user
    // added from https://mcp.github.evil.com/mcp lands at `aime-mcp-github`, and
    // reporting it under `github` puts an attacker's host into the id space that
    // staleConnectorIds() feeds to the chat prompt.
    const reports = classifyProvisioned(
      {
        'aime-mcp-github': {
          url: 'https://mcp.github.evil.com/mcp',
          _meta: { mcpName: 'github', expiresAt: at(-1) },
        },
      },
      NOW,
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].id).not.toBe('github');
    // still visible, so the user's own server keeps its health verdict
    expect(reports[0].serverKey).toBe('aime-mcp-github');
    expect(reports[0].health.needsReconnect).toBe(true);
  });

  it('accepts a built-in name backed by that service own origin', () => {
    const reports = classifyProvisioned(
      { 'aime-mcp-miro': { url: 'https://mcp.miro.com/', _meta: { mcpName: 'miro' } } },
      NOW,
    );
    expect(reports[0].id).toBe('miro');
  });

  it('fails closed when a -mcp- entry claiming a built-in has no url to prove it', () => {
    const reports = classifyProvisioned({ 'aime-mcp-figma': { _meta: { mcpName: 'figma' } } }, NOW);
    expect(reports[0].id).not.toBe('figma');
  });

  it('keeps a name that claims nothing exactly as it is', () => {
    const reports = classifyProvisioned(
      { 'aime-mcp-acmecorp': { url: 'https://mcp.acmecorp.io/mcp' } },
      NOW,
    );
    expect(reports[0].id).toBe('acmecorp');
  });

  it('still trusts _meta.connectorId, which only the provision route writes', () => {
    const reports = classifyProvisioned(
      { 'aime-mcp-github': { url: 'https://evil.example/mcp', _meta: { connectorId: 'github' } } },
      NOW,
    );
    expect(reports[0].id).toBe('github');
  });
});

describe('diffConnections', () => {
  it('reports entries the UI has not picked up yet', () => {
    // e.g. a CLI-written config, or localStorage cleared while .mcp.json remains
    expect(diffConnections([], ['github', 'atlassian'])).toEqual({
      missingInClient: ['atlassian', 'github'],
      missingOnDisk: [],
    });
  });

  it('reports UI entries with nothing behind them', () => {
    expect(diffConnections(['github'], [])).toEqual({
      missingInClient: [],
      missingOnDisk: ['github'],
    });
  });

  it('is empty when the two agree', () => {
    expect(diffConnections(['a', 'b'], ['b', 'a'])).toEqual({
      missingInClient: [],
      missingOnDisk: [],
    });
  });
});
