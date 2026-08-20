import { describe, it, expect } from 'vitest';
import {
  recordAndDetect, LOOP_WINDOW_SIZE, LOOP_DENY_THRESHOLD, type LoopCall,
} from './loop-detector';

/*
 * The browser agent had no loop detection at all — the provider's copy guarded
 * Chat, Cowork and Code, and the browser turn runs its own loop against the raw
 * Messages API where it could not reach it. The visible result was four
 * restatements of one intent with no bound. FM1, arXiv 2606.20724.
 */
describe('recordAndDetect', () => {
  const w = (): LoopCall[] => [];

  it('allows distinct calls indefinitely', () => {
    const win = w();
    for (let i = 0; i < 20; i++) {
      expect(recordAndDetect(win, 'click', { index: i }).action).toBe('allow');
    }
  });

  it('warns, then denies, on repetition', () => {
    const win = w();
    const call = () => recordAndDetect(win, 'navigate', { url: 'https://x' });
    expect(call().action).toBe('allow');
    expect(call().action).toBe('allow');
    expect(call().action).toBe('warn');
    expect(call().action).toBe('warn');
    expect(call().action).toBe('deny');
  });

  it('the denial TELLS THE MODEL WHAT TO DO, rather than only refusing', () => {
    // A model that is blocked without direction tends to try the same thing
    // once more, which is the behaviour this exists to end.
    const win = w();
    let v = recordAndDetect(win, 'click', { index: 1 });
    for (let i = 1; i < LOOP_DENY_THRESHOLD; i++) v = recordAndDetect(win, 'click', { index: 1 });
    expect(v.action).toBe('deny');
    if (v.action !== 'deny') throw new Error('unreachable');
    expect(v.message).toMatch(/loop/i);
    expect(v.message).toMatch(/different approach|tell the user/i);
    expect(v.message).toContain('click');
  });

  it('a DIFFERENT input resets the streak — a retry is not a loop', () => {
    const win = w();
    recordAndDetect(win, 'click', { index: 1 });
    recordAndDetect(win, 'click', { index: 1 });
    recordAndDetect(win, 'click', { index: 1 });
    expect(recordAndDetect(win, 'click', { index: 2 }).action).toBe('allow');
    expect(recordAndDetect(win, 'click', { index: 1 }).action).toBe('allow');
  });

  it('counts CONSECUTIVE calls only', () => {
    // Identical calls five apart are ordinary navigation, not a stuck agent.
    const win = w();
    for (let i = 0; i < 6; i++) {
      recordAndDetect(win, 'navigate', { url: 'https://a' });
      recordAndDetect(win, 'navigate', { url: 'https://b' });
    }
    expect(recordAndDetect(win, 'navigate', { url: 'https://a' }).action).toBe('allow');
  });

  it('keeps the window bounded', () => {
    const win = w();
    for (let i = 0; i < 50; i++) recordAndDetect(win, 'scroll', { y: i });
    expect(win.length).toBe(LOOP_WINDOW_SIZE);
  });

  it('treats undefined and null input as the same call', () => {
    const win = w();
    recordAndDetect(win, 'done', undefined);
    expect(recordAndDetect(win, 'done', null).action).toBe('allow');
    recordAndDetect(win, 'done', undefined);
    expect(recordAndDetect(win, 'done', null).action).toBe('warn');
  });
});
