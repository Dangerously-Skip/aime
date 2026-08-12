import type { ConnectorDefinition } from '@/lib/connectors/types';

/**
 * The OAuth access token a connector stored, whatever shape it stored it in.
 *
 * Connectors declare `tokenInjection` — Google uses
 * `{ method: 'env', envVar: 'GOOGLE_ACCESS_TOKEN' }`, OneDrive uses
 * `{ method: 'header', headerName: 'Authorization', prefix: 'Bearer ' }` — and
 * the secret store persists whichever of those the provisioner wrote. Reading
 * one shape and assuming the other is how a feature works for half the
 * connectors and silently fails for the rest, so this reads the DECLARATION
 * rather than guessing.
 *
 * The store and the key list are injected: this is then a pure function of
 * (declaration, stored secrets), and its failure mode — returning null for a
 * connector that is in fact connected — is testable without a keychain.
 */

export interface StoredSecrets {
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface TokenLookupDeps {
  /** `mcp:<serverKey>` → the secrets written at provision time. */
  read(serverKey: string): Promise<StoredSecrets | undefined>;
}

/**
 * Every key a connector's secrets might live under.
 *
 * Four prefixes because the app was renamed: an install that connected before
 * the rename still has `nib-` entries, and a token that exists under the old
 * name is a connector the user believes is connected.
 */
export function serverKeysFor(connectorId: string): string[] {
  return ['aime-connector-', 'aime-mcp-', 'nib-connector-', 'nib-mcp-'].map((p) => `${p}${connectorId}`);
}

export async function connectorAccessToken(
  connector: Pick<ConnectorDefinition, 'id' | 'mcp'>,
  deps: TokenLookupDeps,
): Promise<string | null> {
  const injection = connector.mcp?.tokenInjection;

  for (const key of serverKeysFor(connector.id)) {
    const secrets = await deps.read(`mcp:${key}`).catch(() => undefined);
    if (!secrets) continue;

    if (injection?.method === 'env') {
      const v = secrets.env?.[injection.envVar]?.trim();
      if (v) return v;
    }
    if (injection?.method === 'header') {
      const raw = secrets.headers?.[injection.headerName]?.trim();
      if (raw) {
        // The provisioner strips the scheme prefix before storing, but an entry
        // written by hand or by an older build may still carry it.
        const prefix = injection.prefix?.trim();
        return prefix && raw.toLowerCase().startsWith(prefix.toLowerCase())
          ? raw.slice(prefix.length).trim()
          : raw;
      }
    }

    /*
     * No declaration, or it did not match: fall back to the only two names a
     * token is ever stored under. A connector whose `tokenInjection` is absent
     * (iCloud runs in-process) has no token here at all, and returning null is
     * the correct, fail-closed answer.
     */
    const loose =
      secrets.env?.GOOGLE_ACCESS_TOKEN?.trim() ||
      secrets.headers?.Authorization?.replace(/^Bearer\s+/i, '').trim();
    if (loose) return loose;
  }

  return null;
}
