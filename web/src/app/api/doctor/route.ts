import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getMcpConfigPath } from '@/lib/app-paths';
import { MCP_CONFIG_FILENAME } from '@/config/branding';
import {
  agentSdkCheck,
  identityFileCheck,
  logFileCheck,
  modelAccessCheck,
  parseProviderSummaries,
  type ClientProviderSummary,
  type HealthCheck,
} from './checks';

export const runtime = 'nodejs';

/**
 * Every place a model credential can live, not just the environment: the env
 * key, the encrypted credential store (keys saved in Settings), Bedrock with
 * BOTH a region and credentials, and the providers the client reports.
 */
async function checkModelAccess(providers: ClientProviderSummary[]): Promise<HealthCheck> {
  const { isBedrockConfigured } = await import('@/lib/bedrock-env');
  const { probeCredentialStore, getCredentialStore } = await import('@/lib/models/credentials');
  const probe = probeCredentialStore();
  let ids: string[] = [];
  if (probe.status === 'ok') {
    try {
      ids = await getCredentialStore().list();
    } catch {
      ids = [];
    }
  }
  return modelAccessCheck({
    envAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    bedrock: {
      region: !!(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION),
      credentials: isBedrockConfigured(),
    },
    store: { status: probe.status, ids, detail: probe.detail },
    providers,
  });
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
  return files.map(({ id, label, file }) => identityFileCheck(id, label, file, fs.existsSync(file)));
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

/**
 * Whether connector tokens are encrypted at rest (DR-14). Reported so the
 * plaintext fallback is never silent — pretending to encrypt would be worse than
 * not encrypting.
 */
async function checkSecretStorage(): Promise<HealthCheck> {
  const { describeSecretStorage } = await import('@/lib/mcp/secret-store');
  const { mode, detail } = describeSecretStorage();
  return {
    id: 'secret_storage',
    label: 'Connector token storage',
    status: mode === 'encrypted' ? 'ok' : 'warn',
    message: detail,
    ...(mode === 'encrypted'
      ? {}
      : { fix: 'Run the packaged app so the OS keychain can supply a master key.' }),
  };
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

async function runChecks(providers: ClientProviderSummary[]): Promise<Response> {
  const [modelAccessCheck, claudeDirCheck, mcpCheck, secretStorageCheck, skillsCheck] =
    await Promise.all([
      checkModelAccess(providers),
      checkClaudeDir(),
      checkProvisionedMcpServers(),
      checkSecretStorage(),
      checkSkillFiles(),
    ]);
  const identityChecks = await checkIdentityFiles();
  const sdkCheck = agentSdkCheck({
    envCliPath: process.env.AIME_SDK_CLI_PATH,
    nodeModulesDir: path.join(process.cwd(), 'node_modules'),
    platform: process.platform,
    arch: process.arch,
    exists: fs.existsSync,
  });
  const logCheck = logFileCheck(process.env.AIME_USER_DATA_DIR, fs.existsSync);

  const checks: HealthCheck[] = [
    modelAccessCheck,
    sdkCheck,
    claudeDirCheck,
    ...identityChecks,
    mcpCheck,
    secretStorageCheck,
    skillsCheck,
    logCheck,
  ];

  const hasError = checks.some((c) => c.status === 'error');
  const hasWarn = checks.some((c) => c.status === 'warn');

  return Response.json({
    ok: !hasError,
    summary: hasError ? 'error' : hasWarn ? 'warn' : 'ok',
    checks,
  });
}

/** Server-side view only: cannot see keyless (local) providers the client configured. */
export async function GET(_req: NextRequest) {
  return runChecks([]);
}

/**
 * POST { providers: [{ id, presetId, label, enabled, modelCount, hasCredentials }] }
 * — the client's provider list (ids and labels, never a secret), so providers
 * that live only in client state, like a local Ollama, count as model access.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { providers?: unknown };
  return runChecks(parseProviderSummaries(body?.providers));
}
