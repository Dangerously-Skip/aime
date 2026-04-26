export const runtime = 'nodejs';

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const execAsync = promisify(exec);

const PLUGINS_DIR = join(homedir(), '.claude', 'plugins');

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

/**
 * Resolve the plugin source into a git clone URL + optional subpath.
 */
function resolveSource(
  source: string | { source: string; url?: string; repo?: string; path?: string; ref?: string }
): { cloneUrl: string; ref?: string; subpath?: string } | null {
  if (typeof source === 'string') {
    // Relative path into the official claude-plugins-public repo
    const clean = source.replace(/^\.\//, '');
    return {
      cloneUrl: 'https://github.com/anthropics/claude-plugins-public.git',
      subpath: clean,
    };
  }

  if (source.source === 'url' && source.url) {
    return { cloneUrl: source.url, ref: source.ref };
  }

  if (source.source === 'github' && source.repo) {
    return { cloneUrl: `https://github.com/${source.repo}.git`, ref: source.ref };
  }

  if (source.source === 'git-subdir' && source.url) {
    return {
      cloneUrl: source.url,
      ref: source.ref,
      subpath: source.path,
    };
  }

  return null;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * POST /api/mcp/install
 * Body: { name, source }
 * Clones the plugin into ~/.claude/plugins/<name>/ and reads its manifest.
 * Returns the plugin's MCP server definitions (so the caller can trigger OAuth if needed).
 */
export async function POST(request: Request) {
  try {
    const { name, source } = await request.json();

    if (!name || !source) {
      return Response.json({ error: 'Missing name or source' }, { status: 400 });
    }

    const resolved = resolveSource(source);
    if (!resolved) {
      return Response.json({ error: 'Unsupported plugin source' }, { status: 400 });
    }

    await mkdir(PLUGINS_DIR, { recursive: true });
    const targetDir = join(PLUGINS_DIR, name);

    if (await dirExists(targetDir)) {
      // Already installed — just read the manifest
      return Response.json({
        success: true,
        alreadyInstalled: true,
        manifest: await readManifest(targetDir),
      });
    }

    if (resolved.subpath) {
      // Sparse checkout for subdir sources
      const tempDir = join(PLUGINS_DIR, `.tmp-${name}-${Date.now()}`);
      const ref = resolved.ref || 'HEAD';
      await execAsync(`git clone --depth 1 ${resolved.ref ? `--branch ${resolved.ref}` : ''} ${JSON.stringify(resolved.cloneUrl)} ${JSON.stringify(tempDir)}`, {
        timeout: 60_000,
      });
      const srcDir = join(tempDir, resolved.subpath);
      if (!(await dirExists(srcDir))) {
        await execAsync(`rm -rf ${JSON.stringify(tempDir)}`);
        return Response.json({ error: `Subpath ${resolved.subpath} not found in repo` }, { status: 404 });
      }
      await execAsync(`mv ${JSON.stringify(srcDir)} ${JSON.stringify(targetDir)}`);
      await execAsync(`rm -rf ${JSON.stringify(tempDir)}`);
      void ref;
    } else {
      const branchArg = resolved.ref ? `--branch ${JSON.stringify(resolved.ref)}` : '';
      await execAsync(
        `git clone --depth 1 ${branchArg} ${JSON.stringify(resolved.cloneUrl)} ${JSON.stringify(targetDir)}`,
        { timeout: 60_000 }
      );
    }

    const manifest = await readManifest(targetDir);

    return Response.json({
      success: true,
      alreadyInstalled: false,
      manifest,
    });
  } catch (error) {
    console.error('[MCP Install] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Install failed' },
      { status: 500 }
    );
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
      // Path to a .mcp.json file
      try {
        const mcpPath = join(pluginDir, plugin.mcpServers);
        const content = await readFile(mcpPath, 'utf-8');
        const parsed = JSON.parse(content) as { mcpServers?: Record<string, McpServerDef> };
        mcpServers = parsed.mcpServers || {};
      } catch (err) {
        console.warn('[MCP Install] Failed to read mcpServers file:', err);
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
