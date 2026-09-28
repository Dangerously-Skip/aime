import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { executableCandidates, type LookupEnv } from './executable-lookup';

/**
 * Async, shell-free `which`. Returns the first matching executable file on
 * PATH (or the absolute path itself), or null. Never spawns a process, so a
 * hostile name is only ever a filename that does not exist.
 */
export async function findExecutable(
  command: string,
  env: LookupEnv = process.env,
  platform: string = process.platform,
): Promise<string | null> {
  for (const candidate of executableCandidates(command, env, platform)) {
    try {
      const s = await stat(candidate);
      if (!s.isFile()) continue;
      // X_OK is meaningless on Windows (everything is "executable"); PATHEXT
      // already did the filtering there.
      if (platform !== 'win32') await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here — keep looking
    }
  }
  return null;
}
