import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from './route';

/**
 * REGRESSION: the stdio branch ran `execSync(\`which ${command}\`)` on the
 * request body, so `sh; touch <file>` created the file. The sentinel is the
 * proof — a PATH lookup that never involves a shell cannot create it.
 */
let dir: string;
let sentinel: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-conn-test-'));
  sentinel = join(dir, 'pwned');
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/customize/connectors/test', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe.runIf(process.platform !== 'win32')('POST /api/customize/connectors/test (stdio)', () => {
  it('reports a real binary as found', async () => {
    const res = await post({ type: 'stdio', command: 'sh' });
    expect(await res.json()).toEqual({ success: true });
  });

  it('reports a missing binary as not found', async () => {
    const res = await post({ type: 'stdio', command: 'definitely-not-a-binary-xyz' });
    expect((await res.json()).success).toBe(false);
  });

  it.each([
    'sh; touch SENTINEL',
    'sh && touch SENTINEL',
    '$(touch SENTINEL)',
    '`touch SENTINEL`',
    'sh\ntouch SENTINEL',
  ])('never runs a shell for %j', async (template) => {
    const res = await post({ type: 'stdio', command: template.replace('SENTINEL', sentinel) });
    expect((await res.json()).success).toBe(false);
    expect(existsSync(sentinel)).toBe(false);
  });

  it('rejects a non-string command', async () => {
    const res = await post({ type: 'stdio', command: ['sh'] });
    expect(res.status).toBe(400);
  });
});
