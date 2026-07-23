/**
 * Product branding — single source of truth.
 *
 * Quarry (nib internal) was renamed AIME for the open-source release.
 * Anything user-visible or model-visible must use these constants, never a
 * hardcoded product name; `branding.test.ts` guards the surface prompts.
 *
 * Infrastructure identifiers (storage-key prefix, data directory, Electron
 * appId) migrate in later P0 slices — see .planning/aime-roadmap.md.
 */

export const APP_NAME = 'AIME';

export const APP_DESCRIPTION = 'An open-source desktop AI workspace';

/** Zustand persist key prefix. Legacy keys are read as a fallback by gated-storage. */
export const STORAGE_PREFIX = 'aime';
export const LEGACY_STORAGE_PREFIX = 'nibcowork';

/** Per-user data directory name under $HOME (scratch, sessions, telemetry). */
export const DATA_DIR_NAME = '.aime';
export const LEGACY_DATA_DIR_NAME = '.quarry';

/** OAuth-provisioned MCP config filenames under ~/.claude/. */
export const MCP_CONFIG_FILENAME = '.aime-mcp.json';
export const LEGACY_MCP_CONFIG_FILENAME = '.quarry-mcp.json';
export const MCP_CLIENTS_FILENAME = '.aime-mcp-clients.json';
export const LEGACY_MCP_CLIENTS_FILENAME = '.quarry-mcp-clients.json';

/** Default clone destination under $HOME for the GitHub clone flow. */
export const REPOS_DIR_NAME = 'AIME';

/** Zustand persist key with the current prefix, e.g. storageKey('settings') → 'aime:settings'. */
export const storageKey = (name: string) => `${STORAGE_PREFIX}:${name}`;
