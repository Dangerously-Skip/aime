import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readObservedTools, recordObservedTools } from './observed-tools';

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
