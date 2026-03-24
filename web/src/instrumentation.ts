/**
 * Next.js instrumentation hook — runs once on server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // In packaged Electron builds, set a global with the path to the Claude SDK
  // cli.js so the provider can pass it as pathToClaudeCodeExecutable.
  // This runs before any request handlers, and globalThis survives across requests.
  const resourcesPath = process.env['QUARRY_RESOURCES_PATH'];
  if (resourcesPath) {
    const path = await import('path');
    const fs = await import('fs');

    const cliPath = path.join(
      resourcesPath, '.next', 'standalone', 'web',
      'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'
    );

    if (fs.existsSync(cliPath)) {
      (globalThis as Record<string, unknown>).__quarryClaudeSDKPath = cliPath;
      console.log('[Quarry] Claude SDK cli.js path set:', cliPath);
    } else {
      console.warn('[Quarry] Claude SDK cli.js not found at:', cliPath);
    }
  }
}
