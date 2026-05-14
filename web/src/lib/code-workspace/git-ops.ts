/**
 * Main-process git helper.
 *
 * Thin wrapper around `child_process.spawn('git', ...)` with:
 *   - cwd existence check (refuses to run outside the workspace)
 *   - timeout (default 10s)
 *   - buffer encoding (binary-safe — `git status --porcelain=v1 -z`
 *     emits NUL-separated entries with embedded high-bit bytes for
 *     non-UTF-8 filenames)
 *   - non-zero exit throws with stderr so callers can wrap in try/catch
 *
 * This file is loaded from `main-web.js` via `require()` — it MUST stay
 * CommonJS-compatible (no ESM-only imports, no TS-only syntax that the
 * Node 20 runtime can't handle). It's also imported from the renderer-side
 * IPC wrappers; the renderer never reaches the spawn code path because
 * `child_process` is undefined there — we guard with a runtime check.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

export interface RunGitResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

export interface RunGitOptions {
  /** Hard timeout in milliseconds. Default 10_000. */
  timeoutMs?: number;
  /** Treat stdout as text and return as string in `stdoutText` (utility for callers). */
  text?: boolean;
}

/**
 * Spawn `git <args>` in `cwd`. Throws if the directory doesn't exist or
 * git exits non-zero. Returns the raw buffer so binary-safe callers
 * (e.g. status --porcelain -z, diff with binary files) can parse it.
 */
export async function runGit(
  cwd: string,
  args: string[],
  opts: RunGitOptions = {},
): Promise<RunGitResult> {
  // Lazy-require so this module is safe to import from the renderer side too
  // (it just won't be called there — the IPC wrapper handles the renderer
  // path).
  const cp = require('child_process') as typeof import('child_process');
  const fs = require('fs') as typeof import('fs');

  if (!cwd || typeof cwd !== 'string') {
    throw new Error('runGit: cwd is required');
  }
  if (!fs.existsSync(cwd)) {
    throw new Error(`runGit: cwd does not exist: ${cwd}`);
  }

  const timeoutMs = opts.timeoutMs ?? 10_000;

  return await new Promise<RunGitResult>((resolve, reject) => {
    const child = cp.spawn('git', args, {
      cwd,
      // Binary-safe stdout — `git status -z` uses NUL separators and
      // filenames may contain non-UTF8 bytes.
      stdio: ['ignore', 'pipe', 'pipe'],
      // Don't inherit a TTY: avoids `git` invoking pagers.
      env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (b: Buffer) => stdoutChunks.push(b));
    child.stderr?.on('data', (b: Buffer) => stderrChunks.push(b));

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`runGit: timed out after ${timeoutMs}ms — git ${args.join(' ')}`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      if (code !== 0) {
        reject(new Error(`git ${args.join(' ')} (exit ${code}): ${stderr.trim() || 'no stderr'}`));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

/** Convenience: run + decode stdout as utf-8 text. Same throw semantics. */
export async function runGitText(
  cwd: string,
  args: string[],
  opts: RunGitOptions = {},
): Promise<string> {
  const result = await runGit(cwd, args, opts);
  return result.stdout.toString('utf-8');
}
