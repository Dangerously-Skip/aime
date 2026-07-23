import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getMcpConfigPath } from '@/lib/app-paths';
import { MCP_CONFIG_FILENAME } from '@/config/branding';

export const runtime = 'nodejs';

interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

async function checkModelAccess(): Promise<HealthCheck> {
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const hasBedrock = !!(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION);
  if (!hasApiKey && !hasBedrock) {
    return {
      id: 'model_access',
      label: 'Model access',
      status: 'warn',
      message: 'No ANTHROPIC_API_KEY or Bedrock env detected — set a key in Settings or .env',
      fix: 'Set ANTHROPIC_API_KEY (or CLAUDE_CODE_USE_BEDROCK=1 + AWS credentials)',
    };
  }
  return {
    id: 'model_access',
    label: 'Model access',
    status: 'ok',
    message: hasApiKey ? 'Anthropic API key configured' : 'AWS Bedrock env detected',
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
  const mcpPath = getMcpConfigPath();
  if (!fs.existsSync(mcpPath)) {
    return {
      id: 'mcp_servers',
      label: 'Connector MCP Servers',
      status: 'warn',
      message: `No provisioned connector servers found (~/.claude/${MCP_CONFIG_FILENAME} missing)`,
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
        : `No servers configured in ${MCP_CONFIG_FILENAME}`,
    };
  } catch {
    return {
      id: 'mcp_servers',
      label: 'Connector MCP Servers',
      status: 'error',
      message: `~/.claude/${MCP_CONFIG_FILENAME} is malformed`,
      fix: `Check or delete ~/.claude/${MCP_CONFIG_FILENAME}`,
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

  const [modelAccessCheck, claudeDirCheck, mcpCheck, skillsCheck] = await Promise.all([
    checkModelAccess(),
    checkClaudeDir(),
    checkProvisionedMcpServers(),
    checkSkillFiles(),
  ]);
  const identityChecks = await checkIdentityFiles();

  checks.push(modelAccessCheck, claudeDirCheck, ...identityChecks, mcpCheck, skillsCheck);

  const hasError = checks.some((c) => c.status === 'error');
  const hasWarn = checks.some((c) => c.status === 'warn');

  return Response.json({
    ok: !hasError,
    summary: hasError ? 'error' : hasWarn ? 'warn' : 'ok',
    checks,
  });
}
