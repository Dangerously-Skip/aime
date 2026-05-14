/**
 * Renderer-side wrappers around the IDE-workspace IPC channels.
 *
 * Wave 1 declares + stubs every channel in main-web.js / preload-web.js so
 * that Wave 2 phases (tree, diff, branch, terminal) can fill the
 * implementations without having to re-touch the preload bridge.
 *
 * All functions degrade gracefully when running outside Electron (returns
 * empty / no-op so SSR pre-renders and unit-test environments don't crash).
 */

import type {
  FsNode,
  GitStatus,
  GitCommit,
  BlameLine,
  PtySession,
} from './types';

type ElectronBridge = {
  // Filesystem
  fsWalk?: (path: string, opts?: { depth?: number; respectGitignore?: boolean }) => Promise<FsNode[]>;
  fsRead?: (path: string) => Promise<{ content: string; encoding: string } | null>;
  fsWrite?: (path: string, content: string) => Promise<{ ok: boolean; error?: string }>;
  fsWatchStart?: (path: string) => Promise<string>;
  fsWatchStop?: (watchId: string) => Promise<void>;
  onFsChange?: (cb: (evt: { watchId: string; path: string; kind: 'add' | 'change' | 'delete' }) => void) => () => void;

  // Git
  gitStatus?: (cwd: string) => Promise<GitStatus | null>;
  gitDiff?: (cwd: string, opts: { path?: string; fromRef?: string; toRef?: string }) => Promise<string>;
  gitBranches?: (cwd: string) => Promise<string[]>;
  gitLog?: (cwd: string, opts?: { path?: string; limit?: number }) => Promise<GitCommit[]>;
  gitBlame?: (cwd: string, path: string) => Promise<BlameLine[]>;
  gitPush?: (cwd: string, branch: string) => Promise<{ ok: boolean; message: string }>;
  openExternal?: (url: string) => Promise<{ ok: boolean }>;

  // PTY
  ptyOpen?: (opts: { cwd: string; cols: number; rows: number }) => Promise<PtySession>;
  ptyInput?: (id: string, data: string) => Promise<void>;
  ptyResize?: (id: string, cols: number, rows: number) => Promise<void>;
  ptyClose?: (id: string) => Promise<void>;
  onPtyOutput?: (cb: (evt: { id: string; data: string }) => void) => () => void;
  onPtyExit?: (cb: (evt: { id: string; code: number | null }) => void) => () => void;
};

function bridge(): ElectronBridge {
  if (typeof window === 'undefined') return {};
  return ((window as unknown as { electronAPI?: ElectronBridge }).electronAPI) ?? {};
}

// ── Filesystem ─────────────────────────────────────────────────────────────

export async function walkFs(
  path: string,
  opts?: { depth?: number; respectGitignore?: boolean },
): Promise<FsNode[]> {
  return (await bridge().fsWalk?.(path, opts)) ?? [];
}

export async function readFile(path: string): Promise<{ content: string; encoding: string } | null> {
  return (await bridge().fsRead?.(path)) ?? null;
}

export async function writeFile(path: string, content: string): Promise<{ ok: boolean; error?: string }> {
  return (
    (await bridge().fsWrite?.(path, content)) ?? {
      ok: false,
      error: "Electron bridge unavailable",
    }
  );
}

export async function watchPath(path: string): Promise<string | null> {
  return (await bridge().fsWatchStart?.(path)) ?? null;
}

export async function unwatchPath(watchId: string): Promise<void> {
  await bridge().fsWatchStop?.(watchId);
}

export function onFsChange(
  cb: (evt: { watchId: string; path: string; kind: 'add' | 'change' | 'delete' }) => void,
): () => void {
  return bridge().onFsChange?.(cb) ?? (() => {});
}

// ── Git ────────────────────────────────────────────────────────────────────

export async function getGitStatus(cwd: string): Promise<GitStatus | null> {
  return (await bridge().gitStatus?.(cwd)) ?? null;
}

export async function getGitDiff(
  cwd: string,
  opts: { path?: string; fromRef?: string; toRef?: string },
): Promise<string> {
  return (await bridge().gitDiff?.(cwd, opts)) ?? '';
}

export async function getGitBranches(cwd: string): Promise<string[]> {
  return (await bridge().gitBranches?.(cwd)) ?? [];
}

export async function getGitLog(
  cwd: string,
  opts?: { path?: string; limit?: number },
): Promise<GitCommit[]> {
  return (await bridge().gitLog?.(cwd, opts)) ?? [];
}

export async function getGitBlame(cwd: string, path: string): Promise<BlameLine[]> {
  return (await bridge().gitBlame?.(cwd, path)) ?? [];
}

export async function pushGitBranch(cwd: string, branch: string): Promise<{ ok: boolean; message: string }> {
  return (
    (await bridge().gitPush?.(cwd, branch)) ?? {
      ok: false,
      message: "Electron bridge unavailable",
    }
  );
}

export async function openExternalUrl(url: string): Promise<boolean> {
  const res = await bridge().openExternal?.(url);
  return !!res?.ok;
}

// ── PTY ────────────────────────────────────────────────────────────────────

export async function openPty(opts: { cwd: string; cols: number; rows: number }): Promise<PtySession | null> {
  return (await bridge().ptyOpen?.(opts)) ?? null;
}

export async function writePty(id: string, data: string): Promise<void> {
  await bridge().ptyInput?.(id, data);
}

export async function resizePty(id: string, cols: number, rows: number): Promise<void> {
  await bridge().ptyResize?.(id, cols, rows);
}

export async function closePty(id: string): Promise<void> {
  await bridge().ptyClose?.(id);
}

export function onPtyOutput(cb: (evt: { id: string; data: string }) => void): () => void {
  return bridge().onPtyOutput?.(cb) ?? (() => {});
}

export function onPtyExit(cb: (evt: { id: string; code: number | null }) => void): () => void {
  return bridge().onPtyExit?.(cb) ?? (() => {});
}
