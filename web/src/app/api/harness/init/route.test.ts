import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  abortMock: vi.fn(),
}));

vi.mock('@/lib/providers', () => ({
  getProvider: () => ({ name: 'claude', query: mocks.queryMock, abort: mocks.abortMock }),
}));
/*
 * The initializer's own suite covers what it does with a plan. Here it only has
 * to call the planner the route hands it, which is the query this test is about.
 */
vi.mock('@/lib/harness/initializer', () => ({
  initializeGoal: async ({ plan }: { plan: (p: string) => Promise<string> }) => {
    await plan('plan this');
    return { ok: false, error: 'unusable plan' };
  },
}));

import { POST } from './route';

let workingDir: string;

beforeEach(async () => {
  mocks.queryMock.mockReset();
  mocks.abortMock.mockReset();
  workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aime-harness-init-'));
});
afterEach(async () => {
  await fs.rm(workingDir, { recursive: true, force: true });
});

const request = (signal?: AbortSignal) =>
  new NextRequest('http://127.0.0.1:3100/api/harness/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'conv1', workingDir, objective: 'ship it', surfaceId: 'cowork' }),
    signal,
  });

describe('POST /api/harness/init — planning is tied to the request', () => {
  it('stops the planner when the caller goes away', async () => {
    const controller = new AbortController();
    mocks.queryMock.mockImplementation(async function* () {
      yield { type: 'text', content: 'thinking…' };
      controller.abort();
      await new Promise((r) => setTimeout(r, 0));
    });

    const res = await POST(request(controller.signal));

    expect(mocks.abortMock).toHaveBeenCalledWith('harness_init_conv1', 'cowork');
    expect(res.status).toBe(499);
  });

  it('leaves a planner whose caller is still there alone', async () => {
    mocks.queryMock.mockImplementation(async function* () {
      yield { type: 'text', content: 'plan' };
    });

    const res = await POST(request());

    expect(mocks.abortMock).not.toHaveBeenCalled();
    expect(res.status).toBe(422); // the stubbed initializer's verdict, passed through
  });
});
