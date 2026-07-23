import { describe, it, expect } from 'vitest';
import { BaseProvider, type QueryParams, type StreamChunk } from './base-provider';

class TestProvider extends BaseProvider {
  get name() { return 'test'; }
  // eslint-disable-next-line require-yield
  async *query(_params: QueryParams): AsyncGenerator<StreamChunk, void, unknown> {
    return;
  }
}

describe('BaseProvider session management', () => {
  it('stores and retrieves sessions per chat', () => {
    const p = new TestProvider();
    expect(p.getSession('c1')).toBeNull();

    p.setSession('c1', 'sess1');
    expect(p.getSession('c1')).toBe('sess1');
    expect(p.getSessionCwd('c1')).toBeNull(); // cwd only stored when provided

    p.setSession('c2', 'sess2', '/tmp/work');
    expect(p.getSessionCwd('c2')).toBe('/tmp/work');
  });

  it('clearSession removes both session and cwd', () => {
    const p = new TestProvider();
    p.setSession('c1', 'sess1', '/tmp/a');
    p.clearSession('c1');
    expect(p.getSession('c1')).toBeNull();
    expect(p.getSessionCwd('c1')).toBeNull();
  });

  it('cleanup clears everything', async () => {
    const p = new TestProvider();
    p.setSession('c1', 's1');
    p.setSession('c2', 's2');
    await p.cleanup();
    expect(p.getSession('c1')).toBeNull();
    expect(p.getSession('c2')).toBeNull();
  });

  it('builds composite abort keys only when a surface is given', () => {
    const p = new TestProvider();
    expect(p.getAbortKey('c1')).toBe('c1');
    expect(p.getAbortKey('c1', 'cowork')).toBe('cowork:c1');
  });
});
