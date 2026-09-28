import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getDataDir,
  getScratchDir,
  getScratchRoot,
  getMcpConfigPath,
  getMcpClientsPath,
} from './app-paths';
import {
  DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  MCP_CONFIG_FILENAME,
  LEGACY_MCP_CONFIG_FILENAME,
} from '@/config/branding';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-paths-test-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
});

afterAll(() => {
  // Best-effort cleanup of the last tmpdir; earlier ones are in os.tmpdir anyway
  fs.rmSync(home, { recursive: true, force: true });
});

describe('getDataDir', () => {
  it('returns ~/<DATA_DIR_NAME> when nothing exists yet', () => {
    expect(getDataDir(home)).toBe(path.join(home, DATA_DIR_NAME));
  });

  it('migrates a legacy data dir by renaming it', () => {
    const legacy = path.join(home, LEGACY_DATA_DIR_NAME);
    fs.mkdirSync(path.join(legacy, 'scratch', 'chat1'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'scratch', 'chat1', 'notes.md'), 'kept');

    const dir = getDataDir(home);

    expect(dir).toBe(path.join(home, DATA_DIR_NAME));
    expect(fs.readFileSync(path.join(dir, 'scratch', 'chat1', 'notes.md'), 'utf-8')).toBe('kept');
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it('leaves the legacy dir alone when the new dir already exists', () => {
    fs.mkdirSync(path.join(home, DATA_DIR_NAME));
    fs.mkdirSync(path.join(home, LEGACY_DATA_DIR_NAME));

    getDataDir(home);
    expect(fs.existsSync(path.join(home, LEGACY_DATA_DIR_NAME))).toBe(true);
  });
});

describe('getScratchDir', () => {
  it('nests per-chat scratch under the data dir', () => {
    expect(getScratchDir('chat42', home)).toBe(
      path.join(home, DATA_DIR_NAME, 'scratch', 'chat42'),
    );
  });

  it.each([
    '0b7c1f9e-3d2a-4c55-9f7e-8a1b2c3d4e5f',
    'harness_init_abc',
    'standing-order-o1-1790000000000',
    'upload_1790000000000',
    'eval-x.1',
  ])('accepts the chat id shape %j', (id) => {
    expect(getScratchDir(id, home)).toBe(path.join(getScratchRoot(home), id));
  });

  // REGRESSION: request input went straight into path.join — `../..` escaped
  // the scratch root, '' meant the root itself, undefined threw a TypeError.
  it.each(['../..', '..', '.', '', 'a/b', 'a\\b', '.hidden', 'x\u0000y', 'x'.repeat(201)])(
    'refuses %j',
    (id) => {
      expect(() => getScratchDir(id, home)).toThrow(/Invalid chat id/);
    },
  );

  it('refuses a non-string', () => {
    expect(() => getScratchDir(undefined as unknown as string, home)).toThrow(/Invalid chat id/);
  });
});

describe('MCP config paths', () => {
  it('migrates the legacy .quarry-mcp.json by renaming it', () => {
    const legacy = path.join(home, '.claude', LEGACY_MCP_CONFIG_FILENAME);
    fs.writeFileSync(legacy, '{"mcpServers":{}}');

    const configPath = getMcpConfigPath(home);

    expect(configPath).toBe(path.join(home, '.claude', MCP_CONFIG_FILENAME));
    expect(fs.readFileSync(configPath, 'utf-8')).toBe('{"mcpServers":{}}');
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it('prefers an existing new-name config over a legacy one', () => {
    fs.writeFileSync(path.join(home, '.claude', MCP_CONFIG_FILENAME), 'new');
    fs.writeFileSync(path.join(home, '.claude', LEGACY_MCP_CONFIG_FILENAME), 'old');

    expect(fs.readFileSync(getMcpConfigPath(home), 'utf-8')).toBe('new');
    // Legacy file untouched
    expect(fs.existsSync(path.join(home, '.claude', LEGACY_MCP_CONFIG_FILENAME))).toBe(true);
  });

  it('resolves the clients file the same way', () => {
    expect(getMcpClientsPath(home)).toBe(path.join(home, '.claude', '.aime-mcp-clients.json'));
  });
});
