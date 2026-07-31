import 'server-only';
// ^ Reaches Node APIs (fs/os/crypto) and must never enter a client bundle.
// Without this the only thing catching a client import is `next build`, the
// slowest gate — and it caught one exactly once, after typecheck and the whole
// unit suite went green. This fails at the IMPORT SITE instead, naming the file
// that did it. If you hit it: the pure part of what you need probably belongs in
// a sibling module (see lib/models/credential-ids.ts for the pattern).

/**
 * The user's security toggles, stored server-side.
 *
 * ## Why they moved off the request body
 *
 * They arrived as a field on the chat request, sent by whichever surface
 * remembered to. Two of nine `provider.query()` callers did:
 *
 *   chat surface, project chats     — no
 *   /api/chat (legacy)              — no
 *   /api/subagent, /batch           — no   ← `spawn_agent` is one model-initiated
 *   standing orders, widget refresh — no      call away, so this alone defeated
 *   run verification                — no      every toggle
 *   cowork, code                    — yes
 *
 * So a control the Settings screen badged ENFORCED did nothing on most paths,
 * and "omit the field" was a way to turn it off. Adding the parameter to seven
 * more call sites would have been the shallow fix: it leaves the next caller to
 * remember, and the failure is silent.
 *
 * Instead the PROVIDER loads them when the caller supplies nothing, from a file
 * only the server writes. Every path is covered by construction, including ones
 * that do not exist yet, and a caller can still pass an explicit set (tests do).
 *
 * Not secret — booleans about the user's own preferences — so this sits beside
 * the other non-secret state rather than in the 0600 credential store.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDataDir } from '../app-paths';

export interface SecuritySettings {
  /** Route a destructive-looking shell command to the human approval gate. */
  blockDangerousCommands: boolean;
  /** Route a command that reaches off this machine to the human approval gate. */
  blockNetworkCommands: boolean;
  /** Refuse file-tool writes that resolve outside the working directory. */
  restrictToProjectFolder: boolean;
  /** Withhold Bash, BashOutput and KillShell entirely. */
  disableBashTool: boolean;
}

/**
 * Safe by default, and deliberately identical to the client store's defaults
 * (`settings-store.ts`) — a fresh install has no file, and the answer then has
 * to be the same one the Settings screen is showing.
 */
export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  blockDangerousCommands: true,
  // Off by default, matching the client store. Unlike the destructive set, the
  // shapes this catches (scp to a host, an SSH forward, a curl upload) are
  // ordinary work for some users, so defaulting it on would prompt on the first
  // legitimate command and get the toggle switched off for good.
  blockNetworkCommands: false,
  restrictToProjectFolder: true,
  disableBashTool: false,
};

export function securitySettingsPath(): string {
  return path.join(getDataDir(), 'security.json');
}

/** Coerce unknown JSON into the shape, falling back to the safe default per field. */
export function parseSecuritySettings(raw: unknown): SecuritySettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SECURITY_SETTINGS };
  const o = raw as Record<string, unknown>;
  const pick = (k: keyof SecuritySettings) =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : DEFAULT_SECURITY_SETTINGS[k];
  return {
    blockDangerousCommands: pick('blockDangerousCommands'),
    blockNetworkCommands: pick('blockNetworkCommands'),
    restrictToProjectFolder: pick('restrictToProjectFolder'),
    disableBashTool: pick('disableBashTool'),
  };
}

/**
 * Cached because `loadSecuritySettings` is reached from the provider on every
 * query, and the file changes only when the user touches Settings — which goes
 * through `saveSecuritySettings` and busts the cache itself.
 */
let cached: SecuritySettings | null = null;

export async function loadSecuritySettings(): Promise<SecuritySettings> {
  if (cached) return cached;
  try {
    cached = parseSecuritySettings(JSON.parse(await fs.readFile(securitySettingsPath(), 'utf-8')));
  } catch {
    // No file yet, or unreadable. Defaults are the safe answer either way — a
    // missing file must not mean "no protection".
    cached = { ...DEFAULT_SECURITY_SETTINGS };
  }
  return cached;
}

export async function saveSecuritySettings(raw: unknown): Promise<SecuritySettings> {
  const next = parseSecuritySettings(raw);
  const file = securitySettingsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
  return next;
}

/** Test seam. */
export function resetSecuritySettingsCache(): void {
  cached = null;
}
