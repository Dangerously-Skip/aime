import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { moveModelCache } from './model-cache-migration';

/**
 * Moving a cached model out of the package dir. Real files in a real tmpdir:
 * the risk here IS the filesystem (a half-copied model that loads as garbage,
 * or a source deleted before its copy was whole), so nothing about it is faked
 * except, in one test, the rename failing as it does across volumes.
 */

let root: string;
let from: string;
let to: string;
let logs: string[];
const log = (message: string) => logs.push(message);

/** A model dir shaped like the real one: configs at the top, weights in onnx/. */
const MODEL: Record<string, string> = {
  'config.json': '{"model_type":"whisper"}',
  'tokenizer.json': '{"tokens":[]}',
  'onnx/encoder_model.onnx': 'E'.repeat(4000),
  'onnx/decoder_model_merged.onnx': 'D'.repeat(6000),
};

function writeModel(dir: string, files = MODEL) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
}

function readModel(dir: string): Record<string, string> {
  return Object.fromEntries(Object.keys(MODEL).map((rel) => [rel, fs.readFileSync(path.join(dir, rel), 'utf-8')]));
}

const exdev = async () => {
  throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-model-move-'));
  from = path.join(root, 'pkg', '.cache', 'Xenova', 'whisper-small');
  to = path.join(root, 'home', '.aime', 'models', 'transformers', 'Xenova', 'whisper-small');
  logs = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('moveModelCache', () => {
  it('renames the model across when both sides share a volume', async () => {
    writeModel(from);
    expect(await moveModelCache({ from, to, log })).toBe('renamed');
    expect(readModel(to)).toEqual(MODEL);
    expect(fs.existsSync(from)).toBe(false);
    expect(logs.join('\n')).toContain(to);
  });

  it('copies, verifies, then deletes the original when rename cannot cross volumes', async () => {
    writeModel(from);
    expect(await moveModelCache({ from, to, log, rename: exdev })).toBe('copied');
    expect(readModel(to)).toEqual(MODEL);
    expect(fs.existsSync(from)).toBe(false);
    expect(fs.existsSync(`${to}.partial`)).toBe(false);
    // A request is waiting on this: it says why it is copying, and how far along it is.
    expect(logs[0]).toMatch(/Copying the cached model .* cannot rename \(EXDEV\)/);
    expect(logs.some((l) => /\d+% \(/.test(l))).toBe(true);
    expect(logs.at(-1)).toContain('moved to');
  });

  it('clears a stale .partial from an interrupted earlier copy', async () => {
    writeModel(from);
    writeModel(`${to}.partial`, { 'onnx/encoder_model.onnx': 'truncated' });
    expect(await moveModelCache({ from, to, log, rename: exdev })).toBe('copied');
    expect(readModel(to)).toEqual(MODEL);
  });

  it('leaves both alone when the new cache already has the model', async () => {
    writeModel(from);
    writeModel(to, { 'config.json': '{"newer":true}' });
    expect(await moveModelCache({ from, to, log })).toBe('already-present');
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf-8')).toBe('{"newer":true}');
    expect(readModel(from)).toEqual(MODEL);
  });

  it('moves into a destination that exists but holds no files (an aborted download)', async () => {
    writeModel(from);
    fs.mkdirSync(path.join(to, 'onnx'), { recursive: true });
    expect(await moveModelCache({ from, to, log })).toBe('renamed');
    expect(readModel(to)).toEqual(MODEL);
  });

  it('does nothing when there is no old cache, or it is the new one', async () => {
    expect(await moveModelCache({ from, to, log })).toBe('nothing-to-move');
    writeModel(to);
    expect(await moveModelCache({ from: to, to, log })).toBe('nothing-to-move');
    expect(readModel(to)).toEqual(MODEL);
    expect(logs).toEqual([]);
  });

  it('a failed move reports and falls back — source intact, nothing half-written', async () => {
    writeModel(from);
    // The destination's parent is a regular FILE: ENOTDIR at once, on every OS.
    const blocked = path.join(root, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');
    const dest = path.join(blocked, 'Xenova', 'whisper-small');

    expect(await moveModelCache({ from, to: dest, log, rename: exdev })).toBe('failed');
    expect(readModel(from)).toEqual(MODEL);
    expect(fs.existsSync(`${dest}.partial`)).toBe(false);
    expect(logs.at(-1)).toMatch(/Could not move the cached model .* it will be downloaded instead/);
  });
});
