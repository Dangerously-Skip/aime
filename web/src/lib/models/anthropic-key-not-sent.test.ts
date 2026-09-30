import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Anthropic key saved in Settings stays on the server.
 *
 * It lives in the encrypted credential store, and every server path that needs
 * it — the chat route, subagents, the provider itself, browser turns, effort
 * estimates, goal runs — reads it from there when a request arrives without
 * one. So a surface that still sends `settings.anthropicApiKey` is only moving
 * a secret through the browser for nothing.
 *
 * `PENDING` lists the call sites that have not been migrated yet, each owned by
 * code being changed elsewhere. It is checked in both directions: a new sender
 * fails, and so does an entry that no longer sends (delete it — and once it is
 * empty, the settings field itself can go).
 */

const SRC = path.resolve(__dirname, '../..');
/** `apiKey: anthropicApiKey`, with or without `|| undefined`, or passed through a helper. */
const SENDS_KEY = /\bapiKey:\s*anthropicApiKey\b/;

const PENDING: string[] = [];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

const senders = sourceFiles(SRC)
  .filter((f) => SENDS_KEY.test(fs.readFileSync(f, 'utf-8')))
  .map((f) => path.relative(SRC, f).split(path.sep).join('/'));

describe('the Anthropic key is not sent from the browser', () => {
  it('the pattern recognises a sender (so this cannot pass by matching nothing)', () => {
    // Every real sender is gone, so prove the detector against the shapes it replaced.
    expect(SENDS_KEY.test('apiKey: anthropicApiKey || undefined,')).toBe(true);
    expect(SENDS_KEY.test('{ surfaceId, apiKey: anthropicApiKey }')).toBe(true);
    expect(SENDS_KEY.test('apiKey: providerKey,')).toBe(false);
  });

  it('no file outside the pending list sends it', () => {
    expect(senders.filter((f) => !PENDING.includes(f))).toEqual([]);
  });

  it('every pending entry still sends it (delete the ones that stopped)', () => {
    for (const f of PENDING) expect(senders, `${f} no longer sends the key`).toContain(f);
  });

  it('the migrated callers do not even read it', () => {
    for (const rel of [
      'components/surfaces/chat/chat-surface.tsx',
      'components/surfaces/cowork/cowork-surface.tsx',
      'components/shared/canvas-overlay.tsx',
      'components/surfaces/code/code-surface.tsx',
      'components/surfaces/code/workspace/branch-header.tsx',
      'components/surfaces/browser/browser-surface.tsx',
      'components/surfaces/assistant/assistant-surface.tsx',
      'components/projects/project-detail.tsx',
      'components/harness/use-start-goal.ts',
      'hooks/use-browser-agent.ts',
      'lib/canvas/dispatch.ts',
    ]) {
      const text = fs.readFileSync(path.join(SRC, rel), 'utf-8');
      expect(text, rel).not.toMatch(/\(s\) => s\.anthropicApiKey\b/);
      expect(text, rel).not.toMatch(/\bapiKey:\s*(anthropicApiKey|apiKey)\b/);
    }
  });
});
