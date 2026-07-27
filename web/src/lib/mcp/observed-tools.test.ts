import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readObservedTools, recordObservedTools, forgetObservedTools } from './observed-tools';

/** Real files: the point of this module is persistence across sessions. */
let dir: string;
let configPath: string;
const toolsPath = () => join(dir, '.aime-mcp-tools.json');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-observed-'));
  configPath = join(dir, '.aime-mcp.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('recordObservedTools / readObservedTools', () => {
  it('round-trips observations', async () => {
    await recordObservedTools(configPath, { 'aime-mcp-acme': ['b', 'a'] });
    expect(await readObservedTools(configPath)).toEqual({ 'aime-mcp-acme': ['a', 'b'] });
  });

  it('stores beside the credential-bearing config, not inside it', async () => {
    await recordObservedTools(configPath, { s: ['t'] });
    // The MCP config holds live tokens at 0600; tool names are public API surface
    // and belong in their own file so they can be read without touching secrets.
    await expect(readFile(toolsPath(), 'utf-8')).resolves.toContain('"t"');
    await expect(readFile(configPath, 'utf-8')).rejects.toThrow();
  });

  it('keeps what it already knew about servers absent from this session', async () => {
    // A session where the user had disabled a connector mounts fewer servers; it
    // must not erase the policy inputs for the ones it did not see.
    await recordObservedTools(configPath, { a: ['a1'], b: ['b1'] });
    await recordObservedTools(configPath, { a: ['a1', 'a2'] });

    expect(await readObservedTools(configPath)).toEqual({ a: ['a1', 'a2'], b: ['b1'] });
  });

  it('deduplicates and sorts, so the file is stable', async () => {
    await recordObservedTools(configPath, { s: ['z', 'a', 'z'] });
    expect(await readObservedTools(configPath)).toEqual({ s: ['a', 'z'] });
  });

  it('does not rewrite the file when nothing changed', async () => {
    await recordObservedTools(configPath, { s: ['a'] });
    const first = await readFile(toolsPath(), 'utf-8');
    await recordObservedTools(configPath, { s: ['a'] });
    // byte-identical, and more importantly no write happened on a hot path
    expect(await readFile(toolsPath(), 'utf-8')).toBe(first);
  });

  it('ignores an empty observation set', async () => {
    await recordObservedTools(configPath, {});
    await expect(readFile(toolsPath(), 'utf-8')).rejects.toThrow();
  });

  it('returns empty when nothing has been recorded', async () => {
    expect(await readObservedTools(configPath)).toEqual({});
  });

  it('survives a corrupt file rather than throwing on a hot path', async () => {
    await writeFile(toolsPath(), 'not json');
    expect(await readObservedTools(configPath)).toEqual({});
  });

  it('discards non-array and non-string entries from a hand-edited file', async () => {
    // A poisoned file must not reach the policy builder.
    await writeFile(
      toolsPath(),
      JSON.stringify({ good: ['a', 1, null, ''], bad: 'not-an-array', alsoBad: { x: 1 } }),
    );
    expect(await readObservedTools(configPath)).toEqual({ good: ['a'] });
  });

  it('ignores a JSON array at the top level', async () => {
    await writeFile(toolsPath(), JSON.stringify(['a', 'b']));
    expect(await readObservedTools(configPath)).toEqual({});
  });
});

describe('forgetObservedTools', () => {
  it('removes what a disconnected server taught us and leaves the rest', async () => {
    // Uninstall used to delete the plugin, the config entry and the OAuth client
    // record and leave this file alone, so the next server to derive the same name
    // (deriveServerName keys off the host, so two hosts can) inherited a policy
    // built from a different server's tools.
    await recordObservedTools(configPath, {
      'aime-mcp-acme': ['delete_everything'],
      'aime-mcp-other': ['read'],
    });

    expect(await forgetObservedTools(configPath, ['aime-mcp-acme'])).toBe(true);
    expect(await readObservedTools(configPath)).toEqual({ 'aime-mcp-other': ['read'] });
  });

  it('removes several keys at once, for every prefix a connector can hold', async () => {
    await recordObservedTools(configPath, {
      'aime-mcp-acme': ['a'],
      'aime-connector-acme': ['b'],
      'nib-mcp-acme': ['c'],
      keep: ['d'],
    });
    await forgetObservedTools(configPath, [
      'aime-mcp-acme',
      'aime-connector-acme',
      'nib-mcp-acme',
      'nib-connector-acme',
    ]);
    expect(await readObservedTools(configPath)).toEqual({ keep: ['d'] });
  });

  it('reports that nothing changed rather than rewriting the file', async () => {
    await recordObservedTools(configPath, { s: ['a'] });
    const before = await stat(toolsPath());
    expect(await forgetObservedTools(configPath, ['not-there'])).toBe(false);
    expect((await stat(toolsPath())).mtimeMs).toBe(before.mtimeMs);
  });

  it('is a no-op when nothing was ever recorded', async () => {
    expect(await forgetObservedTools(configPath, ['anything'])).toBe(false);
    await expect(readFile(toolsPath(), 'utf-8')).rejects.toThrow();
  });

  it('ignores an empty server list', async () => {
    await recordObservedTools(configPath, { s: ['a'] });
    expect(await forgetObservedTools(configPath, [])).toBe(false);
    expect(await readObservedTools(configPath)).toEqual({ s: ['a'] });
  });

  it('never throws on a corrupt file — disconnecting must still succeed', async () => {
    await writeFile(toolsPath(), 'not json');
    await expect(forgetObservedTools(configPath, ['s'])).resolves.toBe(false);
  });
});
