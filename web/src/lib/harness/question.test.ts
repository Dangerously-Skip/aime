import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parkQuestion, readQuestion, answerQuestion, consumeAnswer, isWaiting, QUESTION_FILE,
} from './question';

/**
 * The whole point of this module is that a question does NOT expire.
 *
 * `pending-questions.ts` gives the user five minutes and treats silence as a
 * refusal, which is right for an interactive turn and wrong for a run that
 * continues while its owner is asleep — the question would expire unanswered and
 * the task would fail for a reason that was never a reason.
 */
let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-q-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const NOW = () => '2026-08-18T00:00:00.000Z';

describe('parking', () => {
  it('writes a question and reports the run as waiting', async () => {
    const r = await parkQuestion(dir, { question: 'Which database?', options: ['postgres', 'sqlite'], nowIso: NOW });
    expect(r.ok).toBe(true);
    expect(await isWaiting(dir)).toBe(true);
    const q = await readQuestion(dir);
    expect(q?.question).toBe('Which database?');
    expect(q?.options).toEqual(['postgres', 'sqlite']);
  });

  it('SURVIVES a restart — it is a file, not a promise', async () => {
    // The property that makes it usable overnight. Nothing in memory is needed
    // to know the run is waiting.
    await parkQuestion(dir, { question: 'Which database?', nowIso: NOW });
    const onDisk = JSON.parse(await fsp.readFile(path.join(dir, QUESTION_FILE), 'utf8'));
    expect(onDisk.question).toBe('Which database?');
    expect(onDisk.answer).toBeNull();
  });

  it('has NO expiry field of any kind', async () => {
    const r = await parkQuestion(dir, { question: 'x', nowIso: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const keys = Object.keys(r.question);
    for (const k of keys) expect(k.toLowerCase()).not.toMatch(/expire|timeout|deadline|ttl/);
  });

  it('refuses to replace an unanswered question', async () => {
    // Replacing it would swap out what the user is reading and lose what the run
    // was waiting on.
    await parkQuestion(dir, { question: 'first', nowIso: NOW });
    const second = await parkQuestion(dir, { question: 'second', nowIso: NOW });
    expect(second.ok).toBe(false);
    expect((await readQuestion(dir))?.question).toBe('first');
  });

  it('allows a new question once the last was answered', async () => {
    const first = await parkQuestion(dir, { question: 'first', nowIso: NOW });
    if (!first.ok) throw new Error(first.error);
    await answerQuestion(dir, first.question.id, 'postgres', NOW);
    expect((await parkQuestion(dir, { question: 'second', nowIso: NOW })).ok).toBe(true);
  });

  it('refuses an empty question', async () => {
    expect((await parkQuestion(dir, { question: '   ' })).ok).toBe(false);
  });
});

describe('answering', () => {
  const ask = async () => {
    const r = await parkQuestion(dir, { question: 'Which database?', taskId: 't-003', nowIso: NOW });
    if (!r.ok) throw new Error(r.error);
    return r.question;
  };

  it('records the answer', async () => {
    const q = await ask();
    const r = await answerQuestion(dir, q.id, 'postgres', NOW);
    expect(r.ok).toBe(true);
    expect((await readQuestion(dir))?.answer).toBe('postgres');
    expect(await isWaiting(dir)).toBe(false);
  });

  it('refuses an answer for a DIFFERENT question', async () => {
    /*
     * A panel left open on an old question, or a restart between asking and
     * answering, must not be able to answer something the user never saw.
     */
    await ask();
    const r = await answerQuestion(dir, 'some-other-id', 'postgres', NOW);
    expect(r.ok).toBe(false);
    expect(await isWaiting(dir)).toBe(true);
  });

  it('refuses to answer twice', async () => {
    const q = await ask();
    await answerQuestion(dir, q.id, 'postgres', NOW);
    expect((await answerQuestion(dir, q.id, 'sqlite', NOW)).ok).toBe(false);
    expect((await readQuestion(dir))?.answer).toBe('postgres');
  });

  it('refuses an empty answer', async () => {
    const q = await ask();
    expect((await answerQuestion(dir, q.id, '   ', NOW)).ok).toBe(false);
    expect(await isWaiting(dir)).toBe(true);
  });

  it('refuses when nothing is waiting', async () => {
    expect((await answerQuestion(dir, 'x', 'y', NOW)).ok).toBe(false);
  });
});

describe('consuming', () => {
  it('returns the answer once and clears the slot', async () => {
    // Leaving it would make the next session read a decision already acted on.
    const r = await parkQuestion(dir, { question: 'Which database?', nowIso: NOW });
    if (!r.ok) throw new Error(r.error);
    await answerQuestion(dir, r.question.id, 'postgres', NOW);

    expect((await consumeAnswer(dir))?.answer).toBe('postgres');
    expect(await consumeAnswer(dir)).toBeNull();
    expect(await readQuestion(dir)).toBeNull();
  });

  it('does not consume an UNANSWERED question', async () => {
    await parkQuestion(dir, { question: 'x', nowIso: NOW });
    expect(await consumeAnswer(dir)).toBeNull();
    expect(await isWaiting(dir)).toBe(true);
  });
});

describe('a corrupt question file', () => {
  it('reads as a question, not as "no question"', async () => {
    /*
     * Returning null would silently resume a run that is waiting on a decision —
     * the same reading-of-absence mistake the ledger and the session parser both
     * avoid.
     */
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, QUESTION_FILE), '{ truncated');
    expect(await isWaiting(dir)).toBe(true);
    expect((await readQuestion(dir))?.question).toMatch(/could not be read/i);
  });
});
