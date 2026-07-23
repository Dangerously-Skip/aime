import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { getMcpConfigPath } from '@/lib/app-paths';

/**
 * Read the GitHub PAT from the provisioned MCP config.
 *
 * The client-side connector store stores a "provisioned" sentinel instead of
 * the real PAT (to avoid leaking it into localStorage). The real token lives
 * in the provisioned MCP config under the GitHub connector's headers, so any
 * server-side github API route reads it from there.
 *
 * Returns null if GitHub isn't connected / token isn't present.
 */
export async function readProvisionedGithubToken(): Promise<string | null> {
  const configPath = getMcpConfigPath();
  try {
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as {
      mcpServers?: Record<
        string,
        { headers?: Record<string, string>; env?: Record<string, string> }
      >;
    };
    const entry = config.mcpServers?.['nib-connector-github'];
    if (!entry) return null;

    // HTTP transport: Authorization: Bearer <pat>
    const authHeader = entry.headers?.['Authorization'];
    if (authHeader) {
      return authHeader.replace(/^Bearer\s+/i, '').trim() || null;
    }

    // Stdio transport fallback: GITHUB_PERSONAL_ACCESS_TOKEN in env
    const envToken = entry.env?.['GITHUB_PERSONAL_ACCESS_TOKEN'];
    if (envToken) return envToken;

    return null;
  } catch {
    return null;
  }
}
