import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetPendingExtractions,
  stashExtractedMemories,
  takeExtractedMemories,
} from './pending-extractions';

const mem = (content: string) => ({ content, category: 'fact', tags: [], confidence: 0.7 });

beforeEach(() => resetPendingExtractions());

describe('pending extractions', () => {
  it('hands memories to the next turn of the same conversation, once', () => {
    stashExtractedMemories('c1', [mem('a')]);
    expect(takeExtractedMemories('c2')).toEqual([]);
    expect(takeExtractedMemories('c1')).toEqual([mem('a')]);
    expect(takeExtractedMemories('c1')).toEqual([]);
  });

  it('accumulates across turns that were never followed up', () => {
    stashExtractedMemories('c1', [mem('a')]);
    stashExtractedMemories('c1', [mem('b')]);
    expect(takeExtractedMemories('c1')).toEqual([mem('a'), mem('b')]);
  });

  it('is bounded, dropping the conversation touched longest ago', () => {
    for (let i = 0; i < 70; i++) stashExtractedMemories(`c${i}`, [mem(String(i))]);
    expect(takeExtractedMemories('c0')).toEqual([]);
    expect(takeExtractedMemories('c69')).toEqual([mem('69')]);
  });

  it('ignores empty input and a missing chat id', () => {
    stashExtractedMemories('c1', []);
    stashExtractedMemories('', [mem('x')]);
    expect(takeExtractedMemories('c1')).toEqual([]);
    expect(takeExtractedMemories(undefined)).toEqual([]);
  });
});
