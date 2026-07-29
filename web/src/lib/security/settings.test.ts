import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { homeRef } = vi.hoisted(() => ({ homeRef: { value: '' } }));
vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  return { ...actual, default: actual, homedir: () => homeRef.value || actual.homedir() };
});

import {
  DEFAULT_SECURITY_SETTINGS,
  loadSecuritySettings,
  parseSecuritySettings,
  resetSecuritySettingsCache,
  saveSecuritySettings,
  securitySettingsPath,
} from './settings';

/**
 * These toggles used to ride on the chat request body, which meant seven of nine
 * `provider.query()` callers never sent them and omitting the field switched a
 * protection off. The server owns them now, so the two properties that matter
 * are: a missing or malformed file must mean SAFE, never "no protection"; and
 * what is saved is what is loaded.
 */

beforeEach(() => {
  homeRef.value = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-sec-'));
  resetSecuritySettingsCache();
});
afterEach(() => {
  fs.rmSync(homeRef.value, { recursive: true, force: true });
  homeRef.value = '';
  resetSecuritySettingsCache();
});

describe('defaults', () => {
  it('protects by default, matching the client store', () => {
    expect(DEFAULT_SECURITY_SETTINGS).toEqual({
      blockDangerousCommands: true,
      restrictToProjectFolder: true,
      disableBashTool: false,
    });
  });

  it('a missing file means the defaults, not "nothing enabled"', async () => {
    expect(await loadSecuritySettings()).toEqual(DEFAULT_SECURITY_SETTINGS);
  });

  it('an unreadable or corrupt file also means the defaults', async () => {
    const file = securitySettingsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'not json at all');
    expect(await loadSecuritySettings()).toEqual(DEFAULT_SECURITY_SETTINGS);
  });
});

describe('parseSecuritySettings', () => {
  it('falls back per FIELD, so a partial file cannot silently disable the rest', () => {
    expect(parseSecuritySettings({ blockDangerousCommands: false })).toEqual({
      blockDangerousCommands: false,
      restrictToProjectFolder: true,
      disableBashTool: false,
    });
  });

  it('ignores non-boolean values rather than coercing them', () => {
    // `"false"`, `0` and `null` are all truthy-or-falsy in ways that would make a
    // protection depend on how a caller spelled it.
    expect(parseSecuritySettings({ restrictToProjectFolder: 'false' }).restrictToProjectFolder).toBe(true);
    expect(parseSecuritySettings({ restrictToProjectFolder: 0 }).restrictToProjectFolder).toBe(true);
    expect(parseSecuritySettings({ restrictToProjectFolder: null }).restrictToProjectFolder).toBe(true);
  });

  it('handles garbage input', () => {
    for (const junk of [null, undefined, 42, 'x', []]) {
      expect(parseSecuritySettings(junk)).toEqual(DEFAULT_SECURITY_SETTINGS);
    }
  });

  it('drops unknown keys', () => {
    expect(Object.keys(parseSecuritySettings({ nonsense: true })).sort()).toEqual(
      ['blockDangerousCommands', 'disableBashTool', 'restrictToProjectFolder'],
    );
  });
});

describe('round trip', () => {
  it('loads back what was saved', async () => {
    await saveSecuritySettings({
      blockDangerousCommands: false,
      restrictToProjectFolder: false,
      disableBashTool: true,
    });
    resetSecuritySettingsCache();
    expect(await loadSecuritySettings()).toEqual({
      blockDangerousCommands: false,
      restrictToProjectFolder: false,
      disableBashTool: true,
    });
  });

  it('saving busts the cache, so the next read is not stale', async () => {
    expect((await loadSecuritySettings()).disableBashTool).toBe(false);
    await saveSecuritySettings({ ...DEFAULT_SECURITY_SETTINGS, disableBashTool: true });
    expect((await loadSecuritySettings()).disableBashTool).toBe(true);
  });

  it('writes owner-only, and creates the directory', async () => {
    await saveSecuritySettings(DEFAULT_SECURITY_SETTINGS);
    const stat = fs.statSync(securitySettingsPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('normalises on the way in, so a hostile body cannot store junk', async () => {
    await saveSecuritySettings({ disableBashTool: 'yes', extra: 1 });
    resetSecuritySettingsCache();
    const loaded = await loadSecuritySettings();
    expect(loaded.disableBashTool).toBe(false); // not coerced from 'yes'
    expect(loaded).toEqual(DEFAULT_SECURITY_SETTINGS);
  });
});
