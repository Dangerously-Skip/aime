import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * AGENTS.md format:
 *
 * ```yaml
 * ---
 * agents:
 *   - name: researcher
 *     description: Deep research and web retrieval
 *     model: claude-opus-4-6
 *     systemPromptFile: ~/.claude/agents/researcher.md  # optional
 *     allowedTools: [WebSearch, WebFetch, Read]
 *     triggers: [research, investigate, find out, look up]
 * ---
 * ```
 */

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  systemPromptFile?: string;
  /** Inline system prompt (takes precedence over systemPromptFile) */
  systemPrompt?: string;
  allowedTools?: string[];
  /** Keyword phrases that trigger automatic routing to this agent */
  triggers?: string[];
}

interface AgentsMd {
  agents: AgentConfig[];
}

/** Resolve ~/ paths to absolute paths */
function resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** Naïve YAML-ish frontmatter parser (no external deps) */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    // Use JSON-compatible YAML subset via dynamic require if available,
    // otherwise fall back to manual parsing
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('js-yaml') as { load: (s: string) => unknown };
    return yaml.load(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Read and parse an AGENTS.md file.
 * Returns an empty array if file doesn't exist or can't be parsed.
 */
export function parseAgentsMd(filePath: string): AgentConfig[] {
  try {
    const resolved = resolvePath(filePath);
    if (!fs.existsSync(resolved)) return [];
    const content = fs.readFileSync(resolved, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm) return [];
    const data = fm as unknown as AgentsMd;
    if (!Array.isArray(data.agents)) return [];
    return data.agents.map((a) => ({
      name: String(a.name || ''),
      description: String(a.description || ''),
      model: a.model ? String(a.model) : undefined,
      systemPromptFile: a.systemPromptFile ? String(a.systemPromptFile) : undefined,
      systemPrompt: a.systemPrompt ? String(a.systemPrompt) : undefined,
      allowedTools: Array.isArray(a.allowedTools) ? a.allowedTools.map(String) : undefined,
      triggers: Array.isArray(a.triggers) ? a.triggers.map(String) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Load agents from global (~/.claude/AGENTS.md) and workspace-local (cwd/AGENTS.md).
 * Workspace agents take precedence over global ones with the same name.
 */
export function loadAgents(cwd?: string): AgentConfig[] {
  const globalPath = path.join(os.homedir(), '.claude', 'AGENTS.md');
  const globalAgents = parseAgentsMd(globalPath);

  if (!cwd) return globalAgents;

  const localPath = path.join(cwd, 'AGENTS.md');
  const localAgents = parseAgentsMd(localPath);

  // Merge: local overrides global by name
  const byName = new Map<string, AgentConfig>();
  for (const a of globalAgents) byName.set(a.name, a);
  for (const a of localAgents) byName.set(a.name, a);
  return Array.from(byName.values());
}

/**
 * Match a message against agent triggers.
 * Returns the best-matching AgentConfig or null.
 */
export function matchAgentForMessage(
  message: string,
  agents: AgentConfig[],
): AgentConfig | null {
  const lower = message.toLowerCase();
  for (const agent of agents) {
    if (!agent.triggers || agent.triggers.length === 0) continue;
    for (const trigger of agent.triggers) {
      if (lower.includes(trigger.toLowerCase())) {
        return agent;
      }
    }
  }
  return null;
}

/**
 * Read an agent's system prompt. Returns inline systemPrompt first,
 * then falls back to systemPromptFile.
 */
export function readAgentSystemPrompt(agent: AgentConfig): string {
  if (agent.systemPrompt) return agent.systemPrompt.trim();
  if (!agent.systemPromptFile) return '';
  try {
    const resolved = resolvePath(agent.systemPromptFile);
    if (!fs.existsSync(resolved)) return '';
    return fs.readFileSync(resolved, 'utf-8').trim();
  } catch {
    return '';
  }
}
