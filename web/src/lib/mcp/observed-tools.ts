/**
 * Remembering which tools each MCP server exposes (P3.6b).
 *
 * A per-tool permission policy needs tool names, and names are only known once a
 * session has actually connected to the server. So the first session after a
 * server is added records what it saw, and every later session is governed by
 * that. The gap is real and stated in tool-policy.ts: session one has no
 * SDK-level policy.
 *
 * Kept in its own small file rather than inside the MCP config, because the
 * config holds live credentials at 0600 and this holds nothing sensitive — tool
 * names are public API surface. Keeping them apart means this file can be read,
 * diffed and reported without touching secrets.
 */
import { dirname, join } from 'path';
import type { ObservedTools } from './tool-policy';

/** Sits beside the MCP config; deliberately not inside it. */
function observedToolsPath(mcpConfigPath: string): string {
  return join(dirname(mcpConfigPath), '.aime-mcp-tools.json');
}

export async function readObservedTools(mcpConfigPath: string): Promise<ObservedTools> {
  try {
    const { readFile } = await import('fs/promises');
    const raw = await readFile(observedToolsPath(mcpConfigPath), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Defensive: a hand-edited or corrupt file must not poison policy building.
    const out: ObservedTools = {};
    for (const [server, names] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(names)) {
        out[server] = names.filter((n): n is string => typeof n === 'string' && n.length > 0);
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Write the map back, owner-independent of who mutated it.
 *
 * Shared by record and forget so the two cannot disagree about where the file
 * lives or how it is created.
 */
async function writeObservedTools(mcpConfigPath: string, tools: ObservedTools): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises');
  const path = observedToolsPath(mcpConfigPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(tools, null, 2), 'utf-8');
}

/**
 * Forget what we learned about servers that are no longer connected.
 *
 * The counterpart to `recordObservedTools`, and the reason uninstall could not
 * clean up after itself: this module only ever grew. The stale window is narrow —
 * `recordObservedTools` replaces a server's list wholesale on the next session
 * that mounts it — but it is not empty, because `deriveServerName` keys off the
 * HOST, so a different server can arrive under a name a previous one used. Its
 * first session, the one session with no SDK-level policy of its own, would then
 * be governed by another server's tool names.
 *
 * Returns whether anything was actually removed, so a caller can skip a write.
 * Never throws: this is advisory data and disconnecting must not fail over it.
 */
export async function forgetObservedTools(
  mcpConfigPath: string,
  servers: Iterable<string>,
): Promise<boolean> {
  const drop = [...servers];
  if (drop.length === 0) return false;

  try {
    const existing = await readObservedTools(mcpConfigPath);
    const removed = drop.filter((server) => server in existing);
    if (removed.length === 0) return false;
    for (const server of removed) delete existing[server];
    await writeObservedTools(mcpConfigPath, existing);
    return true;
  } catch (err) {
    console.warn(
      '[MCP] Could not prune observed tools:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Merge freshly observed names in. Servers absent from `observed` keep their
 * previous entry: a session that mounted only some servers (because the user
 * disabled the rest) must not erase what we know about the others.
 */
export async function recordObservedTools(
  mcpConfigPath: string,
  observed: ObservedTools,
): Promise<void> {
  const servers = Object.keys(observed);
  if (servers.length === 0) return;

  try {
    const existing = await readObservedTools(mcpConfigPath);
    let changed = false;
    for (const server of servers) {
      const next = [...new Set(observed[server])].sort();
      const prev = existing[server];
      if (!prev || prev.length !== next.length || prev.some((n, i) => n !== next[i])) {
        existing[server] = next;
        changed = true;
      }
    }
    if (!changed) return; // avoid a write on every single request

    await writeObservedTools(mcpConfigPath, existing);
  } catch (err) {
    // Advisory data — never fail a request over it.
    console.warn('[MCP] Could not record observed tools:', err instanceof Error ? err.message : err);
  }
}
