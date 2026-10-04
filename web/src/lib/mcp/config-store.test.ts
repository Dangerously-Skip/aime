import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  updateMcpConfig,
  updateJsonFile,
  readMcpConfig,
  singleFlight,
  isMcpOAuthManaged,
  SKIP_WRITE,
  McpConfigCorruptError,
  MCP_OAUTH_MANAGED_BY,
  LEGACY_MCP_OAUTH_MANAGED_BY,
} from './config-store';

/**
 * Real files in a temp dir — the lock, the rename and the quarantine are the
 * things under test, so none of them is mocked.
 */
let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'aime-config-store-'));
  file = path.join(dir, '.aime-mcp.json');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setTimeout(r, Math.random() * 5));

describe('updateMcpConfig', () => {
  it('concurrent writers do not lose each other\'s updates', async () => {
    await fs.writeFile(file, JSON.stringify({ mcpServers: { keep: { url: 'x' } } }));
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        updateMcpConfig(async (config) => {
          // Yield between read and write — the window the old code lost updates in.
          await tick();
          (config.mcpServers ??= {})[`s${i}`] = { n: i };
        }, file),
      ),
    );
    const servers = JSON.parse(await fs.readFile(file, 'utf-8')).mcpServers;
    expect(Object.keys(servers)).toHaveLength(41);
    expect(servers.keep).toEqual({ url: 'x' });
  });

  it('a naive read-modify-write in the same shape DOES lose updates (control)', async () => {
    // Proves the test above can fail: same interleaving without the lock.
    // Unlocked, non-atomic writers fail in one of two ways and which one wins is
    // up to the scheduler: updates overwrite each other, or two writeFile calls
    // interleave and leave torn JSON on disk. Both are the loss the lock
    // prevents, so both count — asserting only one of them made this flaky.
    await fs.writeFile(file, JSON.stringify({ mcpServers: {} }));
    await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        try {
          const config = JSON.parse(await fs.readFile(file, 'utf-8'));
          await tick();
          config.mcpServers[`s${i}`] = { n: i };
          await fs.writeFile(file, JSON.stringify(config));
        } catch {
          // Read a torn file mid-write: this writer's update is lost too.
        }
      }),
    );
    let surviving = 0;
    try {
      surviving = Object.keys(JSON.parse(await fs.readFile(file, 'utf-8')).mcpServers).length;
    } catch {
      surviving = 0; // torn on disk
    }
    expect(surviving).toBeLessThan(20);
  });

  it('quarantines a corrupt file and throws instead of writing over it', async () => {
    const torn = '{"mcpServers": {"github": {"headers": {"Authorization": "Bearer ab';
    await fs.writeFile(file, torn);

    const err = await updateMcpConfig((config) => {
      (config.mcpServers ??= {}).fresh = {};
    }, file).catch((e) => e);

    expect(err).toBeInstanceOf(McpConfigCorruptError);
    const moved = (err as McpConfigCorruptError).quarantinedTo!;
    expect(path.basename(moved)).toMatch(/^\.aime-mcp\.corrupt-.+\.json$/);
    expect(await fs.readFile(moved, 'utf-8')).toBe(torn);
    // Nothing was written in its place.
    await expect(fs.access(file)).rejects.toThrow();

    // The next write starts clean rather than failing forever.
    await updateMcpConfig((config) => {
      (config.mcpServers ??= {}).fresh = {};
    }, file);
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ mcpServers: { fresh: {} } });
  });

  it('treats a JSON non-object (array, null) as corrupt too', async () => {
    await fs.writeFile(file, 'null');
    await expect(updateMcpConfig(() => {}, file)).rejects.toBeInstanceOf(McpConfigCorruptError);
  });

  it('creates a missing file, owner-only, and leaves no temp files behind', async () => {
    await updateMcpConfig((config) => {
      (config.mcpServers ??= {}).a = { url: 'u' };
    }, file);
    expect(JSON.parse(await fs.readFile(file, 'utf-8')).mcpServers.a).toEqual({ url: 'u' });
    if (process.platform !== 'win32') {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    }
    expect((await fs.readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('SKIP_WRITE leaves the file untouched and returns undefined', async () => {
    const before = JSON.stringify({ mcpServers: { a: {} } }, null, 4);
    await fs.writeFile(file, before);
    const r = await updateMcpConfig(() => SKIP_WRITE, file);
    expect(r).toBeUndefined();
    expect(await fs.readFile(file, 'utf-8')).toBe(before);
  });

  it('a throwing mutator neither writes nor wedges the lock', async () => {
    await fs.writeFile(file, JSON.stringify({ mcpServers: {} }));
    await expect(
      updateMcpConfig(() => {
        throw new Error('boom');
      }, file),
    ).rejects.toThrow('boom');
    await updateMcpConfig((c) => {
      c.mcpServers!.after = {};
    }, file);
    expect(JSON.parse(await fs.readFile(file, 'utf-8')).mcpServers).toEqual({ after: {} });
  });
});

describe('updateJsonFile', () => {
  it('uses the supplied fallback for a missing file', async () => {
    const clients = path.join(dir, 'clients.json');
    await updateJsonFile<Record<string, unknown>, void>(clients, () => ({}), (c) => {
      c.x = 1;
    });
    expect(JSON.parse(await fs.readFile(clients, 'utf-8'))).toEqual({ x: 1 });
  });
});

describe('readMcpConfig', () => {
  it('reads empty for a corrupt file without moving or rewriting it', async () => {
    await fs.writeFile(file, '{oops');
    expect(await readMcpConfig(file)).toEqual({ mcpServers: {} });
    expect(await fs.readFile(file, 'utf-8')).toBe('{oops');
  });
});

describe('singleFlight', () => {
  it('shares one in-flight call per key and runs again once it settles', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = async () => {
      calls++;
      await gate;
      return calls;
    };
    const all = Promise.all([singleFlight('k', fn), singleFlight('k', fn), singleFlight('k', fn)]);
    release();
    expect(await all).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
    expect(await singleFlight('k', async () => 'again')).toBe('again');
  });

  it('keys are independent', async () => {
    const a = singleFlight('a', async () => 'A');
    const b = singleFlight('b', async () => 'B');
    expect(await Promise.all([a, b])).toEqual(['A', 'B']);
  });
});

describe('managedBy', () => {
  it('writes the AIME value and still recognises the pre-rename one', () => {
    expect(MCP_OAUTH_MANAGED_BY).not.toMatch(/quarry/i);
    expect(isMcpOAuthManaged({ managedBy: MCP_OAUTH_MANAGED_BY })).toBe(true);
    expect(isMcpOAuthManaged({ managedBy: LEGACY_MCP_OAUTH_MANAGED_BY })).toBe(true);
    expect(isMcpOAuthManaged({ managedBy: 'aime' })).toBe(false);
    expect(isMcpOAuthManaged(undefined)).toBe(false);
  });
});
