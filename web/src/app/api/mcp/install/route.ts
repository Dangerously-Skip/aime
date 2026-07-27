export const runtime = 'nodejs';

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, mkdir, stat, rm, rename } from 'fs/promises';
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

    if (plan.value.subpath) {
      // Clone to a scratch dir, then promote the requested subdirectory.
      // The suffix keeps concurrent installs of different plugins apart; the
      // name is already restricted to a single safe path segment.
      tempDir = join(PLUGINS_DIR, `.tmp-${safeName.value}`);
      await rm(tempDir, { recursive: true, force: true });
      await git(buildCloneArgs(plan.value, tempDir));

      const srcDir = join(tempDir, plan.value.subpath);
      if (!(await dirExists(srcDir))) {
        return Response.json(
          { error: `Subpath ${plan.value.subpath} not found in repo` },
          { status: 404 },
        );
      }
      await rename(srcDir, targetDir);
    } else {
      await git(buildCloneArgs(plan.value, targetDir));
    }

    const manifest = await readManifest(targetDir);

    return Response.json({
      success: true,
      alreadyInstalled: false,
      manifest,
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
