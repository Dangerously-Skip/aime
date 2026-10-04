import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { agentSdkBinaryPath } = require_('./agent-sdk-binary');

const nodeModulesDir = path.join('/app', 'node_modules');

describe('agentSdkBinaryPath', () => {
  it('names the per-platform native binary', () => {
    const seen = [];
    const found = agentSdkBinaryPath({
      nodeModulesDir, platform: 'darwin', arch: 'arm64', exists: (p) => { seen.push(p); return true; },
    });
    expect(found).toBe(path.join(nodeModulesDir, '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude'));
    expect(seen).toEqual([found]);
  });

  it('adds .exe on Windows', () => {
    expect(agentSdkBinaryPath({ nodeModulesDir, platform: 'win32', arch: 'arm64', exists: () => true }))
      .toBe(path.join(nodeModulesDir, '@anthropic-ai', 'claude-agent-sdk-win32-arm64', 'claude.exe'));
  });

  it('returns null when the binary is missing, leaving resolution to the SDK', () => {
    expect(agentSdkBinaryPath({ nodeModulesDir, platform: 'linux', arch: 'x64', exists: () => false })).toBeNull();
  });

  // The layout this encodes is the SDK's, so check it against the installed one.
  it('matches where the installed SDK keeps the binary for this machine', () => {
    const found = agentSdkBinaryPath({
      nodeModulesDir: path.join(__dirname, '..', 'node_modules'),
      platform: process.platform, arch: process.arch, exists: existsSync,
    });
    expect(found, 'no native binary for this platform in node_modules').not.toBeNull();
    const versionOf = (dir) => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8')).version;
    // The SDK's `exports` map hides its package.json from require.resolve.
    expect(versionOf(path.dirname(found)))
      .toBe(versionOf(path.join(__dirname, '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk')));
  });
});

describe('main-web.js', () => {
  it('passes the native binary, not the cli.js the SDK stopped shipping', () => {
    const src = readFileSync(path.join(__dirname, '..', 'main-web.js'), 'utf-8');
    expect(src).toMatch(/require\("\.\/electron\/agent-sdk-binary"\)/);
    expect(src).toMatch(/agentSdkBinaryPath\(\{/);
    expect(src).not.toMatch(/'claude-agent-sdk',\s*'cli\.js'/);
  });
});
