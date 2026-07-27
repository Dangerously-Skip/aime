export const runtime = 'nodejs';

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, mkdir, mkdtemp, stat, rm, rename, readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import {
  sanitizePluginName,
  resolveInstallDir,
  resolveSource,
  buildCloneArgs,
  type PluginSource,
} from '@/lib/mcp/install-guard';

/**
 * Plugin install — clones a plugin repo into ~/.claude/plugins/<name>/ and
 * returns its MCP server definitions so the caller can trigger OAuth if needed.
 *
 * Uses execFile with an argv array: there is no shell, so nothing in the
 * request can be interpreted as a command. All path and URL validation lives in
 * install-guard.ts.
 */

const execFileAsync = promisify(execFile);

const PLUGINS_DIR = join(homedir(), '.claude', 'plugins');
const GIT_TIMEOUT_MS = 60_000;

interface McpServerDef {
  type?: string;
  transport?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface PluginManifest {
  name: string;
  description?: string;
  mcpServers?: string | Record<string, McpServerDef>;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function git(args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    timeout: GIT_TIMEOUT_MS,
    // Never let git prompt for credentials — it would hang the request.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
  });
}

/**
 * Scratch directories are dot-prefixed so the plugin scanners skip them, and they
 * live INSIDE the plugins directory rather than os.tmpdir() — the promotion below
 * is a `rename`, which cannot cross filesystems.
 */
const TEMP_PREFIX = '.tmp-';
/** Long enough that no live clone is ever swept; short enough to not accumulate. */
const TEMP_SWEEP_AGE_MS = 2 * GIT_TIMEOUT_MS;

/**
 * Publish a staged tree as the installed plugin — atomically, or not at all.
 *
 * `rename` is the whole mechanism. The kernel refuses to rename a directory onto
 * a POPULATED one, and that refusal is the concurrency control: a second install
 * of the same name cannot merge into, clobber, or half-overwrite the first. It
 * loses and says so.
 *
 * This is why the clone is staged rather than written straight to its final home.
 * Cloning into `targetDir` meant an interrupted or racing clone left a partially
 * populated plugin directory there — and `dirExists(targetDir)` then short-circuits
 * every future install, so nothing could ever repair it.
 */
async function promote(srcDir: string, targetDir: string): Promise<'installed' | 'raced'> {
  try {
    await rename(srcDir, targetDir);
    return 'installed';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOTEMPTY on POSIX, EEXIST/EPERM on Windows.
    const occupied = code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EPERM';
    if (occupied && (await dirExists(targetDir))) return 'raced';
    throw err;
  }
}

/**
 * Remove scratch directories a previous process abandoned (a crash, a SIGKILL).
 *
 * Opportunistic and never fatal: an install must not fail because a leftover
 * could not be tidied. Age-gated so it can never touch a clone that is still
 * running, including one belonging to a concurrent request.
 */
async function sweepAbandonedScratch(now: number): Promise<void> {
  try {
    const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && e.name.startsWith(TEMP_PREFIX))
        .map(async (e) => {
          const dir = join(PLUGINS_DIR, e.name);
          const s = await stat(dir).catch(() => null);
          if (!s || now - s.mtimeMs < TEMP_SWEEP_AGE_MS) return;
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }),
    );
  } catch {
    // Nothing here is required for the install to succeed.
  }
}

/**
 * POST /api/mcp/install
 * Body: { name, source }
 */
export async function POST(request: Request) {
  let tempDir: string | undefined;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { name, source } = body as { name?: unknown; source?: unknown };

    const safeName = sanitizePluginName(name);
    if (!safeName.ok) {
      return Response.json({ error: safeName.error }, { status: 400 });
    }
    if (source === undefined || source === null) {
      return Response.json({ error: 'Missing source' }, { status: 400 });
    }

    const plan = resolveSource(source as PluginSource);
    if (!plan.ok) {
      return Response.json({ error: plan.error }, { status: 400 });
    }

    await mkdir(PLUGINS_DIR, { recursive: true });

    // Swept BEFORE the already-installed early return, not after it.
    //
    // A crash between mkdtemp and the promoting rename (SIGKILL, a dev-server
    // restart, power loss) skips the `finally` below, so the scratch tree survives.
    // The natural next user action is to press Install again — and once the retry
    // succeeds, every subsequent Install on that plugin short-circuits at
    // `dirExists(targetDir)`. With the sweep behind that return the leftover was
    // then unreachable, so it sat in ~/.claude/plugins forever. Age-gated either
    // way, so it still cannot touch a clone that is running.
    await sweepAbandonedScratch(Date.now());

    const target = resolveInstallDir(PLUGINS_DIR, safeName.value);
    if (!target.ok) {
      return Response.json({ error: target.error }, { status: 400 });
    }
    const targetDir = target.value;

    if (await dirExists(targetDir)) {
      // Already installed — just read the manifest
      return Response.json({
        success: true,
        alreadyInstalled: true,
        manifest: await readManifest(targetDir),
      });
    }

    // EVERY install stages into its own scratch directory and is then promoted by
    // a single rename. Two reasons, both of which used to bite:
    //
    //  - The scratch path must be unique per REQUEST. `.tmp-${name}-${Date.now()}`
    //    became `.tmp-${name}`, and the comment was softened to claim only that it
    //    "keeps concurrent installs of DIFFERENT plugins apart" — so two installs
    //    of the SAME name shared one directory. The second one's `rm -rf` deleted
    //    the first one's clone out from under it, and whichever ordering won could
    //    promote a partially populated tree with `success: true`. mkdtemp is the
    //    right tool: the kernel guarantees the name, so there is no window.
    //  - Nothing may ever be cloned directly into `targetDir`. An interrupted
    //    clone there leaves a half plugin that `dirExists` treats as installed
    //    forever, and Install can never repair it.
    tempDir = await mkdtemp(join(PLUGINS_DIR, `${TEMP_PREFIX}${safeName.value}-`));
    const cloneDir = join(tempDir, 'repo');
    await git(buildCloneArgs(plan.value, cloneDir));

    const srcDir = plan.value.subpath ? join(cloneDir, plan.value.subpath) : cloneDir;
    if (!(await dirExists(srcDir))) {
      return Response.json(
        { error: `Subpath ${plan.value.subpath} not found in repo` },
        { status: 404 },
      );
    }

    const outcome = await promote(srcDir, targetDir);

    return Response.json({
      success: true,
      // A same-name install that lost the race did not install anything, but the
      // plugin the user asked for IS now there — reporting a 500 would be wrong.
      alreadyInstalled: outcome === 'raced',
      manifest: await readManifest(targetDir),
    });
  } catch (error) {
    console.error('[MCP Install] Error:', error);
    // Don't hand git's stderr (which can include local paths) to the caller.
    return Response.json({ error: 'Install failed' }, { status: 500 });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readManifest(pluginDir: string): Promise<{
  plugin: PluginManifest | null;
  mcpServers: Record<string, McpServerDef>;
}> {
  // Read plugin.json
  let plugin: PluginManifest | null = null;
  try {
    const pluginJsonPath = join(pluginDir, '.claude-plugin', 'plugin.json');
    const content = await readFile(pluginJsonPath, 'utf-8');
    plugin = JSON.parse(content);
  } catch {
    // No plugin.json — might be a pure MCP server repo
  }

  // Resolve mcpServers — can be a string (path to .mcp.json) or inline object
  let mcpServers: Record<string, McpServerDef> = {};

  if (plugin?.mcpServers) {
    if (typeof plugin.mcpServers === 'string') {
      // Path to a .mcp.json file, relative to the plugin. Confined to the
      // plugin directory so a hostile manifest can't read arbitrary files.
      const { validateSubpath } = await import('@/lib/mcp/install-guard');
      const rel = validateSubpath(plugin.mcpServers);
      if (rel.ok && rel.value) {
        try {
          const content = await readFile(join(pluginDir, rel.value), 'utf-8');
          const parsed = JSON.parse(content) as { mcpServers?: Record<string, McpServerDef> };
          mcpServers = parsed.mcpServers || {};
        } catch (err) {
          console.warn('[MCP Install] Failed to read mcpServers file:', err);
        }
      } else {
        console.warn('[MCP Install] Ignoring out-of-tree mcpServers path:', plugin.mcpServers);
      }
    } else {
      mcpServers = plugin.mcpServers;
    }
  } else {
    // Fallback: check for top-level .mcp.json
    try {
      const mcpPath = join(pluginDir, '.mcp.json');
      const content = await readFile(mcpPath, 'utf-8');
      const parsed = JSON.parse(content) as { mcpServers?: Record<string, McpServerDef> };
      mcpServers = parsed.mcpServers || {};
    } catch {
      // No MCP config
    }
  }

  return { plugin, mcpServers };
}
