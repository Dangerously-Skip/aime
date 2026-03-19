import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadAgents, parseAgentsMd } from '@/lib/agents-parser';
import type { AgentConfig } from '@/lib/agents-parser';

export const runtime = 'nodejs';

function globalAgentsPath(): string {
  return path.join(os.homedir(), '.claude', 'AGENTS.md');
}

function workspaceAgentsPath(cwd: string): string {
  return path.join(cwd, 'AGENTS.md');
}

/** Serialize agents array to AGENTS.md content (YAML frontmatter + blank body) */
function serializeAgentsMd(agents: AgentConfig[]): string {
  if (agents.length === 0) return '---\nagents: []\n---\n';

  const lines: string[] = ['---', 'agents:'];
  for (const a of agents) {
    lines.push(`  - name: ${yamlStr(a.name)}`);
    lines.push(`    description: ${yamlStr(a.description)}`);
    if (a.model) lines.push(`    model: ${yamlStr(a.model)}`);
    if (a.systemPrompt) {
      // Multi-line literal block scalar
      const indented = a.systemPrompt.split('\n').map((l) => `      ${l}`).join('\n');
      lines.push(`    systemPrompt: |`);
      lines.push(indented);
    }
    if (a.systemPromptFile) lines.push(`    systemPromptFile: ${yamlStr(a.systemPromptFile)}`);
    if (a.allowedTools && a.allowedTools.length > 0) {
      lines.push(`    allowedTools: [${a.allowedTools.map(yamlStr).join(', ')}]`);
    }
    if (a.triggers && a.triggers.length > 0) {
      lines.push(`    triggers: [${a.triggers.map(yamlStr).join(', ')}]`);
    }
  }
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

function yamlStr(s: string): string {
  // Quote if contains special chars
  if (/[:#\[\]{},|>&*!'"@%`]/.test(s) || s.includes('\n') || s.trim() !== s) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** Write updated agents list to file, creating dirs as needed */
function writeAgentsMd(filePath: string, agents: AgentConfig[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeAgentsMd(agents), 'utf-8');
}

/**
 * GET /api/agents?cwd=<dir>
 * Returns all agents split by scope.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get('cwd') || undefined;

  const globalPath = globalAgentsPath();
  const globalAgents = parseAgentsMd(globalPath).map((a) => ({ ...a, scope: 'global' as const }));
  const workspaceAgents = cwd
    ? parseAgentsMd(workspaceAgentsPath(cwd)).map((a) => ({ ...a, scope: 'workspace' as const }))
    : [];

  return Response.json({
    agents: [...globalAgents, ...workspaceAgents],
    globalCount: globalAgents.length,
    workspaceCount: workspaceAgents.length,
    allAgents: loadAgents(cwd),
  });
}

/**
 * POST /api/agents
 * Upsert an agent by name into the appropriate AGENTS.md.
 * Body: { agent: AgentConfig, scope: 'global'|'workspace', cwd?: string }
 */
export async function POST(req: NextRequest) {
  let body: { agent?: AgentConfig; scope?: string; cwd?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { agent, scope = 'global', cwd } = body;
  if (!agent || !agent.name) {
    return Response.json({ error: 'agent.name is required' }, { status: 400 });
  }

  const filePath = scope === 'workspace' && cwd
    ? workspaceAgentsPath(cwd)
    : globalAgentsPath();

  const existing = parseAgentsMd(filePath);
  const idx = existing.findIndex((a) => a.name === agent.name);
  if (idx >= 0) {
    existing[idx] = agent;
  } else {
    existing.push(agent);
  }

  writeAgentsMd(filePath, existing);
  return Response.json({ ok: true, agent, scope, filePath });
}

/**
 * DELETE /api/agents
 * Remove an agent by name from the appropriate AGENTS.md.
 * Body: { name: string, scope: 'global'|'workspace', cwd?: string }
 */
export async function DELETE(req: NextRequest) {
  let body: { name?: string; scope?: string; cwd?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, scope = 'global', cwd } = body;
  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  const filePath = scope === 'workspace' && cwd
    ? workspaceAgentsPath(cwd)
    : globalAgentsPath();

  const existing = parseAgentsMd(filePath);
  const filtered = existing.filter((a) => a.name !== name);

  if (filtered.length === existing.length) {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  writeAgentsMd(filePath, filtered);
  return Response.json({ ok: true, name, scope });
}
