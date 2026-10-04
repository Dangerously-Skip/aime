import 'server-only';
import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * The ONE way to read-modify-write `~/.claude/.aime-mcp.json` (and its sibling
 * clients file).
 *
 * Five writers used to each do `readFile → JSON.parse → mutate → writeFile`:
 * the provision route, the customize connector routes, the MCP OAuth exchange,
 * uninstall, and token refresh. Three failures fell out of that:
 *
 *   1. LOST UPDATES. Two requests interleaving their read and write (a token
 *      refresh on one chat while the user clicks Connect) — the second write
 *      silently drops the first's change.
 *   2. TORN FILES. `writeFile` truncates then writes; a crash in between leaves
 *      an empty or half-written file.
 *   3. WIPE ON CORRUPTION. Every reader mapped a parse error to
 *      `{ mcpServers: {} }`, so after (2) the next Connect wrote a config
 *      holding only the new entry — every other connector gone for good.
 *
 * So: an in-process async mutex per file (kept on globalThis — Next can load a
 * lib module more than once across route bundles, and two mutexes are none),
 * write to a temp file in the same directory then `rename` over the target
 * (atomic on one filesystem), and on a parse failure move the file aside to
 * `<name>.corrupt-<ts>.json` and THROW. The quarantined copy still holds the
 * user's tokens; the thrown error names it.
 */

export class McpConfigCorruptError extends Error {
  readonly quarantinedTo: string | null;
  constructor(file: string, quarantinedTo: string | null, cause: unknown) {
    super(
      `${path.basename(file)} could not be parsed, so it was not written over. ` +
        (quarantinedTo
          ? `The unreadable file was moved to ${quarantinedTo}; try again to start a fresh config, ` +
            `or repair and restore that file.`
          : `It could not be moved aside either; repair or delete ${file} and try again.`),
    );
    this.name = 'McpConfigCorruptError';
    this.quarantinedTo = quarantinedTo;
    (this as { cause?: unknown }).cause = cause;
  }
}

export interface McpConfig {
  mcpServers?: Record<string, Record<string, unknown>>;
  disabledMcpServers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/** `_meta.managedBy` written by the MCP OAuth exchange. */
export const MCP_OAUTH_MANAGED_BY = 'aime-mcp-oauth';
/** What builds before the rename wrote; still recognised when reading. */
export const LEGACY_MCP_OAUTH_MANAGED_BY = 'quarry-mcp-oauth';

export function isMcpOAuthManaged(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const by = (meta as { managedBy?: unknown }).managedBy;
  return by === MCP_OAUTH_MANAGED_BY || by === LEGACY_MCP_OAUTH_MANAGED_BY;
}

// ── mutex ────────────────────────────────────────────────────────────────────

const LOCKS_KEY = Symbol.for('aime.mcp.config-store.locks');
const REFRESH_KEY = Symbol.for('aime.mcp.config-store.refreshes');

function lockTable(): Map<string, Promise<unknown>> {
  const g = globalThis as Record<symbol, Map<string, Promise<unknown>> | undefined>;
  return (g[LOCKS_KEY] ??= new Map());
}

async function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const locks = lockTable();
  const key = path.resolve(file);
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  // What the NEXT caller waits on: this run, settled either way.
  const tail = run.catch(() => {});
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

// ── read / write ─────────────────────────────────────────────────────────────

function quarantineName(file: string): string {
  const dir = path.dirname(file);
  const base = path.basename(file).replace(/\.json$/i, '');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${base}.corrupt-${ts}-${randomBytes(3).toString('hex')}.json`);
}

/**
 * Parse `file` for a write. Missing → `fallback`. Unparseable (or not a JSON
 * object) → moved aside and McpConfigCorruptError thrown.
 */
async function readForUpdate<T extends object>(file: string, fallback: () => T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return fallback();
    throw err;
  }
  let parsed: unknown;
  let cause: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    cause = err;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;

  let moved: string | null = quarantineName(file);
  try {
    await fs.rename(file, moved);
    await fs.chmod(moved, 0o600).catch(() => {});
  } catch {
    moved = null;
  }
  console.error(`[MCP config] ${file} is not valid JSON; quarantined to ${moved ?? '(failed)'}`);
  throw new McpConfigCorruptError(file, moved, cause ?? new Error('not a JSON object'));
}

/** Owner-only, atomic: temp file in the same directory, fsync, rename. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fs.open(tmp, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  // `mode` only applies on create; re-tighten a file written before this was enforced.
  await fs.chmod(file, 0o600).catch(() => {});
}

/** Returned by a mutator to say "nothing changed — do not write". */
export const SKIP_WRITE: unique symbol = Symbol('skip-write');

/**
 * Read-modify-write a JSON object file under the per-file lock.
 *
 * `mutate` receives the parsed object (or `fallback()` if the file is absent)
 * and mutates it in place. Its return value is passed back to the caller; if it
 * returns `SKIP_WRITE` the file is left untouched (the caller gets `undefined`).
 * Async work inside `mutate` (a secret-store write, say) is covered by the lock,
 * which is the point — do NOT do slow network I/O in there.
 */
export async function updateJsonFile<T extends object, R>(
  file: string,
  fallback: () => T,
  mutate: (data: T) => R | typeof SKIP_WRITE | Promise<R | typeof SKIP_WRITE>,
): Promise<R | undefined> {
  return withFileLock(file, async () => {
    const data = await readForUpdate(file, fallback);
    const result = await mutate(data);
    if (result === SKIP_WRITE) return undefined;
    await writeJsonAtomic(file, data);
    return result as R;
  });
}

/** `updateJsonFile` for the MCP config, defaulting to the app's config path. */
export async function updateMcpConfig<R>(
  mutate: (config: McpConfig) => R | typeof SKIP_WRITE | Promise<R | typeof SKIP_WRITE>,
  file?: string,
): Promise<R | undefined> {
  const target = file ?? (await import('@/lib/app-paths')).getMcpConfigPath();
  return updateJsonFile<McpConfig, R>(target, () => ({ mcpServers: {} }), mutate);
}

/**
 * Read the MCP config for DISPLAY or mounting. Missing → empty. Unparseable →
 * empty too (a reader has nothing to protect), but never written back: every
 * writer goes through `updateMcpConfig`, which quarantines instead.
 */
export async function readMcpConfig(file?: string): Promise<McpConfig> {
  const target = file ?? (await import('@/lib/app-paths')).getMcpConfigPath();
  try {
    const parsed = JSON.parse(await fs.readFile(target, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as McpConfig;
  } catch {
    // fall through
  }
  return { mcpServers: {} };
}

// ── single-flight ────────────────────────────────────────────────────────────

/**
 * Run `fn` once per key at a time; concurrent callers share the in-flight
 * promise. Used for OAuth refresh: two chats starting together both saw the
 * token as expiring and both POSTed the refresh token — and a provider that
 * rotates refresh tokens honours the first and rejects (sometimes revokes on)
 * the second.
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<symbol, Map<string, Promise<unknown>> | undefined>;
  const table = (g[REFRESH_KEY] ??= new Map());
  const existing = table.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => {
    if (table.get(key) === p) table.delete(key);
  });
  table.set(key, p);
  return p;
}
