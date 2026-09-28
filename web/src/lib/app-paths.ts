import 'server-only';
// ^ Reaches Node APIs (fs/os/crypto) and must never enter a client bundle.
// Without this the only thing catching a client import is `next build`, the
// slowest gate — and it caught one exactly once, after typecheck and the whole
// unit suite went green. This fails at the IMPORT SITE instead, naming the file
// that did it. If you hit it: the pure part of what you need probably belongs in
// a sibling module (see lib/models/credential-ids.ts for the pattern).

/**
 * Server-side application paths (Node only — uses fs).
 *
 * Centralizes the per-user data directory (~/.aime) and the provisioned MCP
 * config files (~/.claude/.aime-mcp.json), with one-time lazy migration from
 * the legacy Quarry locations (~/.quarry, .quarry-mcp*.json). Migration is a
 * same-volume rename; on any failure we fall back to the new path and leave
 * the legacy data untouched.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  MCP_CONFIG_FILENAME,
  LEGACY_MCP_CONFIG_FILENAME,
  MCP_CLIENTS_FILENAME,
  LEGACY_MCP_CLIENTS_FILENAME,
} from '@/config/branding';

/** Rename legacy → current if only the legacy path exists. Returns the current path. */
function migrated(current: string, legacy: string): string {
  try {
    if (!fs.existsSync(current) && fs.existsSync(legacy)) {
      fs.renameSync(legacy, current);
    }
  } catch {
    // Migration is best-effort — use the new path regardless.
  }
  return current;
}

/** ~/.aime — migrates ~/.quarry on first touch. */
export function getDataDir(home: string = os.homedir()): string {
  return migrated(path.join(home, DATA_DIR_NAME), path.join(home, LEGACY_DATA_DIR_NAME));
}

/**
 * May this string name a scratch directory? One plain path segment: letters,
 * digits, `_`, `-`, `.` — not starting with a dot (so never `.` or `..`), at
 * most 200 characters. Real chat ids (UUIDs, `harness_<uuid>`,
 * `standing-order-<id>-<ts>`) all fit.
 */
export function isSafeChatId(chatId: unknown): chatId is string {
  return typeof chatId === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/.test(chatId);
}

/** ~/.aime/scratch — the parent of every chat's scratch directory. */
export function getScratchRoot(home: string = os.homedir()): string {
  return path.join(getDataDir(home), 'scratch');
}

/**
 * ~/.aime/scratch/<chatId> — per-conversation scratch space.
 *
 * THROWS on an id that is not a single safe segment. Callers passed request
 * input straight through: `../..` resolved outside the scratch root (and was
 * then written to), `undefined` threw a TypeError deep in `path.join`, and `''`
 * silently meant the root itself. Validating here covers every caller at once.
 */
export function getScratchDir(chatId: string, home: string = os.homedir()): string {
  if (!isSafeChatId(chatId)) {
    throw new Error(`Invalid chat id for scratch directory: ${JSON.stringify(String(chatId).slice(0, 80))}`);
  }
  return path.join(getScratchRoot(home), chatId);
}

/** ~/.claude/.aime-mcp.json — migrates the legacy .quarry-mcp.json on first touch. */
export function getMcpConfigPath(home: string = os.homedir()): string {
  const claudeDir = path.join(home, '.claude');
  return migrated(
    path.join(claudeDir, MCP_CONFIG_FILENAME),
    path.join(claudeDir, LEGACY_MCP_CONFIG_FILENAME),
  );
}

/** ~/.claude/.aime-mcp-clients.json — migrates the legacy clients file on first touch. */
export function getMcpClientsPath(home: string = os.homedir()): string {
  const claudeDir = path.join(home, '.claude');
  return migrated(
    path.join(claudeDir, MCP_CLIENTS_FILENAME),
    path.join(claudeDir, LEGACY_MCP_CLIENTS_FILENAME),
  );
}
