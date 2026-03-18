import fs from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';

const PLUGINS_DIR = path.join(os.homedir(), '.claude', 'plugins');

interface PluginManifest {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  keywords?: string[];
  [key: string]: unknown;
}

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  path: string;
  skillCount: number;
  agentCount: number;
  hasHooks: boolean;
  hasMcp: boolean;
}

/**
 * GET /api/customize/plugins — Discover installed plugins
 */
export async function GET() {
  const plugins: PluginEntry[] = [];

  if (!fs.existsSync(PLUGINS_DIR)) {
    return Response.json({ plugins });
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  } catch {
    return Response.json({ plugins });
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = path.join(PLUGINS_DIR, entry.name);
    const metaDir = path.join(pluginDir, '.claude-plugin');
    const manifestPath = path.join(metaDir, 'plugin.json');

    // Also check for plugins that have a direct plugin.json
    const altManifestPath = path.join(pluginDir, 'plugin.json');
    const actualManifestPath = fs.existsSync(manifestPath) ? manifestPath : (fs.existsSync(altManifestPath) ? altManifestPath : null);

    let manifest: PluginManifest = {};
    if (actualManifestPath) {
      try {
        manifest = JSON.parse(fs.readFileSync(actualManifestPath, 'utf-8'));
      } catch {}
    }

    // Count skills (directories with SKILL.md)
    const skillsDir = path.join(pluginDir, 'skills');
    let skillCount = 0;
    if (fs.existsSync(skillsDir)) {
      try {
        const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true });
        skillCount = skillDirs.filter(d =>
          d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, 'SKILL.md'))
        ).length;
      } catch {}
    }

    // Count agents
    const agentsDir = path.join(pluginDir, 'agents');
    let agentCount = 0;
    if (fs.existsSync(agentsDir)) {
      try {
        agentCount = fs.readdirSync(agentsDir, { withFileTypes: true })
          .filter(d => d.isDirectory()).length;
      } catch {}
    }

    // Check for hooks and MCP
    const hasHooks = fs.existsSync(path.join(pluginDir, 'hooks'));
    const hasMcp = fs.existsSync(path.join(pluginDir, 'mcp'));

    plugins.push({
      id: entry.name,
      name: manifest.name || entry.name,
      description: manifest.description || '',
      version: manifest.version || '0.0.0',
      author: manifest.author || 'Unknown',
      path: pluginDir,
      skillCount,
      agentCount,
      hasHooks,
      hasMcp,
    });
  }

  return Response.json({ plugins });
}
