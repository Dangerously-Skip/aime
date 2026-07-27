import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { provisionConnector, deprovisionConnector } from './provisioner';
import { CONNECTOR_MAP } from './registry';

/**
 * The regression (DEFECT 1): `/api/connectors/provision` DELETE grew an `intent`
 * parameter — `disable` keeps the credential, `disconnect` destroys it — and
 * defaults to `disable`. `deprovisionConnector()` sent no intent at all, so the
 * Disconnect button in the Connectors screen performed a *disable*: the MCP entry
 * was stashed, the encrypted credential was left sitting at rest, and the grant
 * was never revoked upstream. The user asked for the connection to be destroyed
 * and it was merely switched off.
 *
 * Intent is therefore required here: there is no correct default for "delete the
 * user's credential or not", so no call site gets to omit it.
 */

const fetchMock = vi.fn();

const url = (i: number) => String(fetchMock.mock.calls[i][0]);
const init = (i: number) => fetchMock.mock.calls[i][1] as RequestInit;
const body = (i: number) => JSON.parse(init(i).body as string) as Record<string, unknown>;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{"success":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deprovisionConnector — disable and disconnect are different requests', () => {
  it('asks for a destructive disconnect explicitly', async () => {
    await deprovisionConnector('github', 'disconnect');

    expect(init(0).method).toBe('DELETE');
    expect(url(0)).toContain('connectorId=github');
    expect(url(0)).toContain('intent=disconnect');
  });

  it('asks for a reversible disable explicitly', async () => {
    await deprovisionConnector('github', 'disable');

    expect(url(0)).toContain('intent=disable');
    // Not merely "the default happens to be disable" — said out loud, so a
    // change of default cannot silently start deleting credentials.
    expect(url(0)).not.toContain('intent=disconnect');
  });

  it('encodes the connector id', async () => {
    await deprovisionConnector('a b&c', 'disable');
    expect(url(0)).toContain('connectorId=a%20b%26c');
  });

  it('surfaces the server error rather than reporting success', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'intent must be "disable" or "disconnect"' }), {
        status: 400,
      }),
    );
    await expect(deprovisionConnector('github', 'disable')).rejects.toThrow(/intent must be/);
  });
});

describe('provisionConnector — a token is optional, and a fake one is never invented', () => {
  it('omits the token field entirely when the client holds no credential', async () => {
    // The re-enable path: the entry and its secrets survived the disable, so the
    // server reuses what it already has. Sending the hydrate sentinel
    // ('provisioned') as the credential is what this replaces.
    await provisionConnector(CONNECTOR_MAP['github']);

    expect(init(0).method).toBe('POST');
    expect(body(0)).not.toHaveProperty('token');
    expect(init(0).body).not.toContain('provisioned');
  });

  it('sends a real credential when there is one', async () => {
    await provisionConnector(CONNECTOR_MAP['github'], 'ghp_real');
    expect(body(0).token).toBe('ghp_real');
  });

  it('passes refresh metadata through', async () => {
    await provisionConnector(CONNECTOR_MAP['github'], 'ghp_real', {
      refreshToken: 'rt',
      expiresAt: 123,
    });
    expect(body(0)).toMatchObject({ refreshToken: 'rt', expiresAt: 123 });
  });
});
