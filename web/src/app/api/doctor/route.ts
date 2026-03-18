import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const runtime = 'nodejs';

interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

async function checkAnthropicKey(): Promise<HealthCheck> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      id: 'anthropic_key',
      label: 'Anthropic API Key',
      status: 'error',
      message: 'ANTHROPIC_API_KEY is not set',
      fix: 'Add ANTHROPIC_API_KEY to your .env file',
    };
  }
  if (!key.startsWith('sk-ant-')) {
    return {
      id: 'anthropic_key',
      label: 'Anthropic API Key',
      status: 'warn',
      message: 'API key does not start with sk-ant- — may be invalid',
      fix: 'Verify the key at https://console.anthropic.com',
    };
  }
  // Minimal validation: just check format, avoid live API call to keep doctor fast
  return {
    id: 'anthropic_key',
    label: 'Anthropic API Key',
    status: 'ok',
    message: `Key present (${key.slice(0, 12)}…)`,
  };
}

async function checkComposioKey(): Promise<HealthCheck> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) {
    return {
      id: 'composio_key',
      label: 'Composio API Key',
      status: 'warn',
      message: 'COMPOSIO_API_KEY not set — connector integrations disabled',
      fix: 'Add COMPOSIO_API_KEY to your .env file to enable Composio tools',
    };
  }
  return {
    id: 'composio_key',
    label: 'Composio API Key',
    status: 'ok',
    message: `Key present (${key.slice(0, 8)}…)`,
  };
}

async function checkClaudeDir(): Promise<HealthCheck> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const exists = fs.existsSync(claudeDir);
  if (!exists) {
    return {
      id: 'claude_dir',
      label: '~/.claude directory',
      status: 'warn',
      message: '~/.claude does not exist — identity/memory files will not be loaded',
      fix: 'Run: mkdir -p ~/.claude',
    };
  }
  const writable = (() => {
    try { fs.accessSync(claudeDir, fs.constants.W_OK); return true; } catch { return false; }
  })();
  if (!writable) {
    return {
      id: 'claude_dir',
      label: '~/.claude directory',
      status: 'error',
      message: '~/.claude exists but is not writable',
      fix: 'Run: chmod u+w ~/.claude',
    };
  }
  return {
    id: 'claude_dir',
    label: '~/.claude directory',
    status: 'ok',
    message: `${claudeDir} is writable`,
  };
}

async function checkIdentityFiles(): Promise<HealthCheck[]> {
  const files = [
    { id: 'soul_md', label: 'SOUL.md', file: path.join(os.homedir(), '.claude', 'SOUL.md') },
    { id: 'user_md', label: 'USER.md', file: path.join(os.homedir(), '.claude', 'USER.md') },
    { id: 'memory_md', label: 'MEMORY.md', file: path.join(os.homedir(), '.claude', 'MEMORY.md') },
  ];
  return files.map(({ id, label, file }) => {
    const exists = fs.existsSync(file);
    return {
      id,
      label,
      status: exists ? 'ok' : 'warn' as 'ok' | 'warn',
      message: exists ? `${label} found at ${file}` : `${label} not found — identity injection disabled`,
      fix: exists ? undefined : `Create ${file} to configure the assistant's identity`,
    };
  });
}

async function checkProvisionedMcpServers(): Promise<HealthCheck> {
  const mcpPath = path.join(os.homedir(), '.claude', '.mcp.json');
  if (!fs.existsSync(mcpPath)) {
    return {
      id: 'mcp_servers',
      label: 'Connector MCP Servers',
      status: 'warn',
      message: 'No provisioned connector servers found (~/.claude/.mcp.json missing)',
      fix: 'Connect integrations via Customize → Connectors',
    };
  }
  try {
    const raw = fs.readFileSync(mcpPath, 'utf-8');
    const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    const count = Object.keys(config.mcpServers ?? {}).length;
    return {
      id: 'mcp_servers',
      label: 'Connector MCP Servers',
      status: count > 0 ? 'ok' : 'warn',
      message: count > 0
        ? `${count} server(s) configured: ${Object.keys(config.mcpServers ?? {}).join(', ')}`
        : 'No servers configured in .mcp.json',
    };
  } catch {
    return {
      id: 'mcp_servers',
      label: 'Connector MCP Servers',
      status: 'error',
      message: '~/.claude/.mcp.json is malformed',
      fix: 'Check or delete ~/.claude/.mcp.json',
    };
  }
}

async function checkSkillFiles(): Promise<HealthCheck> {
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) {
    return {
      id: 'skills',
      label: 'Custom Skills',
      status: 'ok',
      message: 'No custom skills directory (~/.claude/skills) — using bundled skills only',
    };
  }
  try {
    const entries = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.md'));
    return {
      id: 'skills',
      label: 'Custom Skills',
      status: 'ok',
      message: `${entries.length} custom skill(s) found in ~/.claude/skills`,
    };
  } catch {
    return {
      id: 'skills',
      label: 'Custom Skills',
      status: 'warn',
      message: '~/.claude/skills exists but could not be read',
    };
  }
}

export async function GET(_req: NextRequest) {
  const checks: HealthCheck[] = [];

  const [apiKeyCheck, composioCheck, claudeDirCheck, mcpCheck, skillsCheck] = await Promise.all([
    checkAnthropicKey(),
    checkComposioKey(),
    checkClaudeDir(),
    checkProvisionedMcpServers(),
    checkSkillFiles(),
  ]);
  const identityChecks = await checkIdentityFiles();

  checks.push(apiKeyCheck, composioCheck, claudeDirCheck, ...identityChecks, mcpCheck, skillsCheck);

  const hasError = checks.some((c) => c.status === 'error');
  const hasWarn = checks.some((c) => c.status === 'warn');

  return Response.json({
    ok: !hasError,
    summary: hasError ? 'error' : hasWarn ? 'warn' : 'ok',
    checks,
  });
}
