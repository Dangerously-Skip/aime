import { describe, it, expect, vi } from 'vitest';
import { findUnregisteredArtifacts, markTurnStart, turnStartedAt } from './artifact-reconcile';

/**
 * The failure this recovers from, stated concretely: an agent built an 18-slide
 * deck, the stuck-tool watchdog killed the stream half a second before a slow
 * WebFetch returned, and the deck — complete, on disk, 13.33×7.50in — never
 * appeared in Artifacts, because artifact cards are produced by stream events
 * and the stream was gone. The user was told to try again.
 */

const respond = (files: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files }) }) as unknown as typeof fetch;

const TURN_START = 1_000_000;

describe('recovering artifacts an aborted turn never announced', () => {
  it('returns a file written during the turn that the UI never saw', async () => {
    const fetchImpl = respond([
      { path: '/scratch/c1/deck.pptx', name: 'deck.pptx', modifiedAt: TURN_START + 5_000 },
    ]);
    const found = await findUnregisteredArtifacts('c1', [], TURN_START, fetchImpl);
    expect(found).toEqual(['/scratch/c1/deck.pptx']);
  });

  it('does not re-register a file the UI already has', async () => {
    const fetchImpl = respond([
      { path: '/scratch/c1/deck.pptx', name: 'deck.pptx', modifiedAt: TURN_START + 5_000 },
      { path: '/scratch/c1/notes.md', name: 'notes.md', modifiedAt: TURN_START + 6_000 },
    ]);
    const found = await findUnregisteredArtifacts(
      'c1',
      ['/scratch/c1/deck.pptx'],
      TURN_START,
      fetchImpl,
    );
    expect(found).toEqual(['/scratch/c1/notes.md']);
  });

  /**
   * The scratch directory accumulates across a conversation. Without the time
   * window, one abort would dump every file from every previous turn into
   * Artifacts — a recovery that makes the panel less usable than the bug did.
   */
  it('ignores files left by earlier turns', async () => {
    const fetchImpl = respond([
      { path: '/scratch/c1/old.md', name: 'old.md', modifiedAt: TURN_START - 60_000 },
      { path: '/scratch/c1/new.md', name: 'new.md', modifiedAt: TURN_START + 1 },
    ]);
    const found = await findUnregisteredArtifacts('c1', [], TURN_START, fetchImpl);
    expect(found).toEqual(['/scratch/c1/new.md']);
  });

  it('keeps a file written in the same millisecond the turn started', async () => {
    const fetchImpl = respond([
      { path: '/scratch/c1/a.md', name: 'a.md', modifiedAt: TURN_START },
    ]);
    expect(await findUnregisteredArtifacts('c1', [], TURN_START, fetchImpl)).toEqual([
      '/scratch/c1/a.md',
    ]);
  });
});

/**
 * This runs inside the abort path, on a turn that has already failed. Throwing
 * here would replace a recoverable artifact gap with a broken finalisation.
 */
describe('it cannot make a bad turn worse', () => {
  it('returns nothing when the request fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(findUnregisteredArtifacts('c1', [], TURN_START, fetchImpl)).resolves.toEqual([]);
  });

  it('returns nothing on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    await expect(findUnregisteredArtifacts('c1', [], TURN_START, fetchImpl)).resolves.toEqual([]);
  });

  it('survives a response that is not the shape it expects', async () => {
    const fetchImpl = respond('not an array');
    await expect(findUnregisteredArtifacts('c1', [], TURN_START, fetchImpl)).resolves.toEqual([]);
  });
});

describe('the turn clock', () => {
  it('reports nothing for a chat that never started a turn', () => {
    expect(turnStartedAt('never-ran')).toBeUndefined();
  });

  it('records the start so an abort can bound its search', () => {
    markTurnStart('c2', TURN_START);
    expect(turnStartedAt('c2')).toBe(TURN_START);
  });
});
