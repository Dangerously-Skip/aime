import path from 'path';
import fs from 'fs';

/**
 * Resolve the Claude Agent SDK cli.js path for packaged Electron builds.
 * Returns undefined when running in dev mode (SDK resolves itself).
 *
 * AIME_RESOURCES_PATH is injected by main-web.js into the standalone
 * server's environment when running in a packaged Electron build.
 */
export function getClaudeSDKPath(): string | undefined {
  // Read env at runtime — this file is server-only and won't be inlined
  const resourcesPath = process.env['AIME_RESOURCES_PATH'];
  if (!resourcesPath) return undefined;

  const cliPath = path.join(
    resourcesPath,
    '.next', 'standalone', 'web', 'node_modules',
    '@anthropic-ai', 'claude-agent-sdk', 'cli.js'
  );

  if (fs.existsSync(cliPath)) {
    return cliPath;
  }

  console.warn('[AIME] Claude SDK cli.js not found at:', cliPath);
  return undefined;
}
