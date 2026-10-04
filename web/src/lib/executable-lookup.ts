/**
 * Resolve a command name against PATH without a shell.
 *
 * Both call sites this replaced ran `execSync(\`which ${name}\`)` with a name
 * that came from outside the process — a request body
 * (`/api/customize/connectors/test`) and a SKILL.md `requires.bins` list — so
 * `jq; rm -rf ~` or `$(curl … | sh)` was a command, not a name. `which` also
 * does not exist on Windows, and `execSync` held the event loop.
 *
 * This module is PURE (no node imports) because `skill-parser.ts` is bundled
 * into client components; each caller does its own filesystem probe.
 * `find-executable.ts` is the async server-side wrapper.
 */

export interface LookupEnv {
  PATH?: string;
  PATHEXT?: string;
  [key: string]: string | undefined;
}

// Control characters (incl. NUL and newlines) are never part of a real
// executable name, and NUL would make the fs call throw rather than miss.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isWindows(platform: string): boolean {
  return platform === 'win32';
}

function isAbsolutePath(p: string, platform: string): boolean {
  if (isWindows(platform)) return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
  return p.startsWith('/');
}

function joinPath(dir: string, name: string, platform: string): string {
  const sep = isWindows(platform) ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

/**
 * Every absolute path that, if it is an executable file, satisfies `command`.
 * Empty when the name can never resolve: blank, control characters, or a
 * relative path with a separator (`../bin/sh`, `./x`) — those would resolve
 * against whatever the server's cwd happens to be.
 */
export function executableCandidates(
  command: string,
  env: LookupEnv,
  platform: string,
): string[] {
  if (typeof command !== 'string') return [];
  const name = command.trim();
  if (!name || name.length > 1024 || CONTROL_CHARS.test(name)) return [];

  const win = isWindows(platform);
  const exts = win
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [];
  const withExts = (base: string): string[] => {
    if (!win) return [base];
    const lower = base.toLowerCase();
    const hasExt = exts.some((e) => lower.endsWith(e.toLowerCase()));
    return hasExt ? [base, ...exts.map((e) => base + e)] : exts.map((e) => base + e);
  };

  if (isAbsolutePath(name, platform)) return withExts(name);
  if (/[\\/]/.test(name)) return [];

  const dirs = (env.PATH || '')
    .split(win ? ';' : ':')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    // An empty PATH entry means cwd to a shell; same objection as `./x`.
    .filter((d) => d && isAbsolutePath(d, platform));

  const out: string[] = [];
  for (const dir of dirs) out.push(...withExts(joinPath(dir, name, platform)));
  return out;
}
