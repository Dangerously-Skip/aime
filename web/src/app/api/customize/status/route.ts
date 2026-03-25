import fs from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
const PLUGINS_DIR = path.join(CLAUDE_DIR, 'plugins');
const MCP_JSON_PATH = path.join(CLAUDE_DIR, '.quarry-mcp.json');

/**
 * GET /api/customize/status — Aggregate status of skills, connectors, plugins
 *
 * Returns counts and basic info from filesystem scanning.
 * When a live session is active, the client can supplement this with
 * system:init data from the SSE stream.
 */
export async function GET() {
  // Count skills
  let skillCount = 0;
  const skillNames: string[] = [];
  if (fs.existsSync(SKILLS_DIR)) {
    try {
      const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'))) {
          skillCount++;
          skillNames.push(entry.name);
        }
      }
    } catch {}
  }

  // Count MCP servers
  let connectorCount = 0;
  const connectorNames: string[] = [];
  try {
    if (fs.existsSync(MCP_JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(MCP_JSON_PATH, 'utf-8'));
      const servers = data.mcpServers || {};
      connectorNames.push(...Object.keys(servers));
      connectorCount = connectorNames.length;
    }
  } catch {}

  // Count plugins
  let pluginCount = 0;
  const pluginNames: string[] = [];
  if (fs.existsSync(PLUGINS_DIR)) {
    try {
      const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          pluginCount++;
          pluginNames.push(entry.name);
        }
      }
    } catch {}
  }

  return Response.json({
    skills: { count: skillCount, names: skillNames },
    connectors: { count: connectorCount, names: connectorNames },
    plugins: { count: pluginCount, names: pluginNames },
  });
}
