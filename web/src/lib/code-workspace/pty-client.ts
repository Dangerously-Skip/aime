/**
 * Renderer-side helpers for the Code-surface terminal.
 *
 * Holds a module-level Map of "session attachments" keyed by workspace path
 * so a PTY survives when the terminal panel unmounts (e.g. user toggles the
 * panel off, switches surfaces, then comes back). The xterm.js component
 * looks up the active session here on mount and re-attaches output streams.
 *
 * The renderer never owns the PTY itself — it lives in the Electron main
 * process. We just keep the session metadata + a last-visible timestamp so
 * the hook can implement idle-cleanup (close PTYs after 30 minutes inactive).
 */

import type { PtySession } from './types';

interface PtyAttachment {
  session: PtySession;
  /** Scratch buffer for output the user hasn't seen yet (panel hidden). */
  pendingOutput: string;
  /** Wall-clock millis when this terminal was last user-visible. */
  lastVisibleAt: number;
}

const attachments = new Map<string, PtyAttachment>();

export function getAttachment(workspace: string): PtyAttachment | null {
  return attachments.get(workspace) ?? null;
}

export function setAttachment(workspace: string, session: PtySession): PtyAttachment {
  const existing = attachments.get(workspace);
  const next: PtyAttachment = existing
    ? { ...existing, session }
    : { session, pendingOutput: '', lastVisibleAt: Date.now() };
  attachments.set(workspace, next);
  return next;
}

export function appendPendingOutput(workspace: string, data: string): void {
  const a = attachments.get(workspace);
  if (!a) return;
  // Cap the buffer so an unattended terminal can't eat all the memory.
  const MAX = 64 * 1024;
  a.pendingOutput = (a.pendingOutput + data).slice(-MAX);
}

export function consumePendingOutput(workspace: string): string {
  const a = attachments.get(workspace);
  if (!a) return '';
  const out = a.pendingOutput;
  a.pendingOutput = '';
  return out;
}

export function touchVisible(workspace: string): void {
  const a = attachments.get(workspace);
  if (a) a.lastVisibleAt = Date.now();
}

export function clearAttachment(workspace: string): void {
  attachments.delete(workspace);
}

export function listAttachments(): Array<{ workspace: string; attachment: PtyAttachment }> {
  return Array.from(attachments.entries()).map(([workspace, attachment]) => ({ workspace, attachment }));
}
