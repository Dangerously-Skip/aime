import { describe, it, expect, beforeEach } from 'vitest';
import { useConnectorStore } from './connector-store';

/**
 * The regression (DEFECT 6): the store held the same fact twice and the two
 * copies disagreed.
 *
 * `connectorStates[id].authenticated` is what every badge, `getEnabledConnectorIds`
 * and every row in the Connectors screen reads. `isAuthenticated(id)`
 * additionally required a truthy
 * `tokens[id]` — so any connector whose credential does not live in the browser
 * (ambient AWS IAM, an MCP that signs itself in, anything reconciled from the
 * provisioned config where the token never leaves the server) read as connected
 * everywhere except through the store's own accessor.
 *
 * `authenticated` is authoritative: whether we happen to hold a copy of the
 * credential is a separate question from whether the service is connected.
 */

beforeEach(() => {
  useConnectorStore.setState({ connectorStates: {}, tokens: {}, tokenMeta: {} });
});

describe('connector-store — one answer to "is this connected?"', () => {
  it('agrees with the authenticated flag for a connector with no client-side token', () => {
    const s = useConnectorStore.getState();
    s.markProvisioned('aws');

    const after = useConnectorStore.getState();
    expect(after.connectorStates['aws']?.authenticated).toBe(true);
    expect(after.tokens['aws']).toBeUndefined();
    // The whole point: the accessor and the flag cannot disagree.
    expect(after.isAuthenticated('aws')).toBe(true);
  });

  it('marking provisioned invents no token', () => {
    useConnectorStore.getState().markProvisioned('linear');
    const after = useConnectorStore.getState();
    expect(after.tokens).toEqual({});
    expect(after.connectorStates['linear']).toMatchObject({ authenticated: true, enabled: true });
    // Enabled AND authenticated, so it counts as connected for the request path.
    expect(after.getEnabledConnectorIds()).toContain('linear');
  });

  it('still reports a connector nobody connected as not authenticated', () => {
    expect(useConnectorStore.getState().isAuthenticated('slack')).toBe(false);
  });

  it('clearToken revokes the claim, token or no token', () => {
    const s = useConnectorStore.getState();
    s.markProvisioned('aws');
    useConnectorStore.getState().clearToken('aws');

    const after = useConnectorStore.getState();
    expect(after.isAuthenticated('aws')).toBe(false);
    expect(after.connectorStates['aws']?.authenticated).toBe(false);
  });

  it('a real credential still reads as authenticated', () => {
    useConnectorStore.getState().setToken('github', 'ghp_x');
    expect(useConnectorStore.getState().isAuthenticated('github')).toBe(true);
  });
});
