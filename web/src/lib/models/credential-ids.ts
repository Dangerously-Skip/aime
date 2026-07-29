/**
 * The credential-id namespace: which ids in the shared credential store belong
 * to a model provider, and which belong to somebody else.
 *
 * Split out of ./credentials.ts because that module imports `fs` (via
 * app-paths) and this is needed by a CLIENT component — the Settings provider
 * manager. Importing the whole store from the browser pulled `fs`, `os` and
 * `path` into the client bundle and broke the build:
 *
 *   Module not found: Can't resolve 'fs'
 *   ./src/lib/app-paths.ts ← credentials.ts ← provider-manager.tsx ← … ← page.tsx
 *
 * Neither `tsc --noEmit` nor the unit suite can see that: it is a Next.js
 * client/server boundary violation, which only `next build` catches. Keep this
 * file dependency-free so it stays importable from either side.
 */

/**
 * Who else keeps records in the shared credential store.
 *
 * ONE encrypted file is shared by three writers, and only one of them is a model
 * provider:
 *
 *   `mcp:<serverKey>`  connector OAuth tokens   (lib/mcp/secret-store.ts)
 *   `anthropic`        the BYOK key mirror      (settings → connectors-section)
 *   `<uuid>`           a model provider         (onboarding / provider-manager)
 *
 * That was implicit, and the cost of leaving it implicit was real: the Settings
 * orphan sweep computed "not a known provider ⇒ orphaned", decided every
 * connector's tokens were junk, and offered a one-click delete. The namespace is
 * declared here so a caller reasons about it deliberately instead of inferring
 * it from the ids that happen to be present.
 *
 * Deliberately an ALLOWLIST — `isProviderCredentialId` says what a provider
 * record looks like — rather than a denylist of reserved names. A denylist is
 * wrong by default for anything added later; an allowlist merely fails to
 * classify it, which is the safe direction for a function whose output is fed to
 * a delete button.
 */
export const RESERVED_CREDENTIAL_IDS = ['anthropic'] as const;

/** Prefix used by connector secrets. See `secretKeyForServer`. */
export const MCP_CREDENTIAL_PREFIX = 'mcp:';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this id a MODEL PROVIDER's record — i.e. one the provider store is
 * responsible for and could legitimately have orphaned?
 *
 * Both creation sites mint `crypto.randomUUID()`, so the shape is the signal.
 * Anything else (a connector, the BYOK mirror, a namespace added later) is not
 * ours to judge.
 */
export function isProviderCredentialId(id: string): boolean {
  if (id.startsWith(MCP_CREDENTIAL_PREFIX)) return false;
  if ((RESERVED_CREDENTIAL_IDS as readonly string[]).includes(id)) return false;
  return UUID_RE.test(id);
}

