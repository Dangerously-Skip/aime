import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';

/**
 * The plugin list must show PLUGINS — nothing else that happens to be a directory
 * under ~/.claude/plugins.
 *
 * REGRESSION: this scanner skipped nothing. `/api/mcp/installed` has always had
 * `if (name.startsWith('.')) continue;`, and this one did not, so the two
 * disagreed about the same directory. The reachable consequence is the install
 * route's staging directory: every install stages into `.tmp-<name>-<random>` and
 * promotes it with a rename, and a crash between those two steps (SIGKILL, power
 * loss, a dev-server restart mid-clone) leaves that directory behind. It has no
 * manifest, so it surfaced here as a plugin called `.tmp-my-plugin-a1b2c3` at
 * version 0.0.0 by "Unknown" — offering the user a row they cannot use, for
 * something that is not installed.
 */

const HOME = '/tmp/aime-plugins-list-test-home';
const PLUGINS_DIR = join(HOME, '.claude', 'plugins');

// The route takes a DEFAULT import of 'os', so the mock has to supply `default`
// as well as the named export — otherwise `os.homedir()` is the real one and the
// suite scans the developer's own ~/.claude/plugins.
vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  const patched = { ...actual, homedir: () => HOME };
  return { ...patched, default: patched };
});

const listPlugins = async (): Promise<Array<{ id: string; name: string }>> => {
  const { GET } = await import('./route');
  const res = await GET();
  return (await res.json()).plugins;
};

/** A plugin as a completed install leaves it: manifest, a skill, an agent. */
async function installReal(name: string) {
  await mkdir(join(PLUGINS_DIR, name, '.claude-plugin'), { recursive: true });
  await writeFile(
    join(PLUGINS_DIR, name, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.2.3', description: 'real', author: 'me' }),
    'utf-8',
  );
  await mkdir(join(PLUGINS_DIR, name, 'skills', 'do-thing'), { recursive: true });
  await writeFile(join(PLUGINS_DIR, name, 'skills', 'do-thing', 'SKILL.md'), '# skill', 'utf-8');
  await mkdir(join(PLUGINS_DIR, name, 'agents', 'helper'), { recursive: true });
}

/** What a crashed install leaves behind: the mkdtemp scratch dir, half-cloned. */
async function abandonedScratch(name: string) {
  const dir = join(PLUGINS_DIR, `.tmp-${name}-a1b2c3`, 'repo');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'partial.txt'), 'half a clone', 'utf-8');
}

beforeEach(async () => {
  await rm(HOME, { recursive: true, force: true });
  await mkdir(PLUGINS_DIR, { recursive: true });
  vi.resetModules();
});

afterEach(async () => {
  await rm(HOME, { recursive: true, force: true });
});

describe('GET /api/customize/plugins — dot-directories are not plugins', () => {
  it('REGRESSION: an abandoned .tmp-* staging directory is not listed as a plugin', async () => {
    await installReal('real-plugin');
    await abandonedScratch('real-plugin');

    const plugins = await listPlugins();

    expect(plugins.map((p) => p.id)).toEqual(['real-plugin']);
    // Said separately: the failure mode was a row whose id STARTS with .tmp-,
    // whatever suffix mkdtemp happened to pick.
    expect(plugins.some((p) => p.id.startsWith('.'))).toBe(false);
  });

  it('skips every dot-directory, matching /api/mcp/installed', async () => {
    await installReal('real-plugin');
    for (const hidden of ['.git', '.DS_Store_dir', '.tmp-x-1', '.cache']) {
      await mkdir(join(PLUGINS_DIR, hidden), { recursive: true });
    }

    expect((await listPlugins()).map((p) => p.id)).toEqual(['real-plugin']);
  });

  it('still reports a genuine plugin in full', async () => {
    await installReal('real-plugin');

    const [plugin] = (await listPlugins()) as Array<Record<string, unknown>>;
    expect(plugin).toMatchObject({
      id: 'real-plugin',
      name: 'real-plugin',
      description: 'real',
      version: '1.2.3',
      author: 'me',
      skillCount: 1,
      agentCount: 1,
      hasHooks: false,
      hasMcp: false,
    });
  });

  it('returns an empty list when the plugins directory does not exist', async () => {
    await rm(HOME, { recursive: true, force: true });
    expect(await listPlugins()).toEqual([]);
  });
});
