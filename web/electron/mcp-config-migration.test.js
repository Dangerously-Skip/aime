import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { migrateMcpConfigFile, writeFileAtomicSync } = require('./mcp-config-migration.js');
/** The CommonJS `fs` the module under test holds — spyable, unlike the ESM namespace. */
const cjsFs = require('fs');

/**
 * The launch-time MCP config repair. The file holds every connector the user
 * has set up, so the write has to be all-or-nothing — the server's own writer
 * is, and this one used a truncating writeFileSync.
 */

let dir;
const quiet = { log: () => {}, warn: () => {} };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-mcp-migrate-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name, obj, mode = 0o600) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(obj), { mode });
  fs.chmodSync(file, mode);
  return file;
};

describe('migrateMcpConfigFile', () => {
  it('repairs the known-broken entries and keeps everything else', () => {
    const file = write('.aime-mcp.json', {
      mcpServers: {
        'nib-mcp-miro': { url: 'https://mcp.miro.com/mcp' },
        'nib-connector-aws': { command: 'npx', args: ['-y', '@aws/mcp-server-aws'] },
        github: { url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer x' } },
      },
    });
    expect(migrateMcpConfigFile(file, quiet)).toBe(true);
    const out = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(out.mcpServers['nib-mcp-miro'].url).toBe('https://mcp.miro.com/');
    expect(out.mcpServers['nib-connector-aws']).toEqual({ command: 'uvx', args: ['awslabs.core-mcp-server@latest'] });
    expect(out.mcpServers.github.headers.Authorization).toBe('Bearer x');
  });

  it('leaves a healthy file byte-for-byte alone', () => {
    const file = write('.aime-mcp.json', { mcpServers: { github: { url: 'https://x' } } });
    const before = fs.readFileSync(file, 'utf-8');
    expect(migrateMcpConfigFile(file, quiet)).toBe(false);
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
  });

  it('writes by rename, never by truncating the live file', () => {
    const file = write('.aime-mcp.json', { mcpServers: { 'nib-mcp-miro': { url: 'https://mcp.miro.com/mcp' } } });
    const renames = vi.spyOn(cjsFs, 'renameSync');
    const direct = vi.spyOn(cjsFs, 'writeFileSync');
    migrateMcpConfigFile(file, quiet);
    expect(renames).toHaveBeenCalledTimes(1);
    expect(renames.mock.calls[0][1]).toBe(file);
    // Nothing wrote to the target path itself.
    expect(direct.mock.calls.some((c) => c[0] === file)).toBe(false);
    // And no temp file is left behind.
    expect(fs.readdirSync(dir)).toEqual(['.aime-mcp.json']);
  });

  it('keeps the owner-only mode the server gave the file', () => {
    const file = write('.aime-mcp.json', { mcpServers: { 'nib-mcp-miro': { url: 'https://mcp.miro.com/mcp' } } }, 0o600);
    migrateMcpConfigFile(file, quiet);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('a failed write leaves the original intact and no temp file', () => {
    const file = write('.aime-mcp.json', { mcpServers: { 'nib-mcp-miro': { url: 'https://mcp.miro.com/mcp' } } });
    const before = fs.readFileSync(file, 'utf-8');
    vi.spyOn(cjsFs, 'renameSync').mockImplementation(() => {
      throw new Error('EXDEV');
    });
    expect(migrateMcpConfigFile(file, quiet)).toBe(false);
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    expect(fs.readdirSync(dir)).toEqual(['.aime-mcp.json']);
  });

  it('never throws on a missing or corrupt file', () => {
    expect(migrateMcpConfigFile(path.join(dir, 'absent.json'), quiet)).toBe(false);
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{not json');
    expect(migrateMcpConfigFile(bad, quiet)).toBe(false);
    expect(fs.readFileSync(bad, 'utf-8')).toBe('{not json');
  });
});

describe('writeFileAtomicSync', () => {
  it('creates a new file owner-only', () => {
    const file = path.join(dir, 'new.json');
    writeFileAtomicSync(file, '{}');
    expect(fs.readFileSync(file, 'utf-8')).toBe('{}');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
