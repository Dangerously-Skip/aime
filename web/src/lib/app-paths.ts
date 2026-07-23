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

/** ~/.aime/scratch/<chatId> — per-conversation scratch space. */
export function getScratchDir(chatId: string, home: string = os.homedir()): string {
  return path.join(getDataDir(home), 'scratch', chatId);
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
