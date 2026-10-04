import { describe, it, expect } from 'vitest';
import { upstreamKey } from './upstream-key';

const req = (headers: Record<string, string>) => new Request('http://127.0.0.1/x', { headers });
const LOCAL = 'local-token-0123456789abcdef';

describe('upstreamKey', () => {
  it('uses x-api-key', () => {
    expect(upstreamKey(req({ 'x-api-key': 'sk-1' }), LOCAL)).toBe('sk-1');
  });

  it('never falls back to Authorization — that is the local API token here', () => {
    expect(upstreamKey(req({ authorization: `Bearer ${LOCAL}` }), LOCAL)).toBeUndefined();
    expect(upstreamKey(req({ authorization: 'Bearer anything' }), null)).toBeUndefined();
  });

  it('refuses the local token even when it arrives as x-api-key', () => {
    expect(upstreamKey(req({ 'x-api-key': LOCAL }), LOCAL)).toBeUndefined();
  });

  it('refuses the proxy-scoped token as x-api-key too — it must never leave the machine', () => {
    const SCOPED = 'scoped-proxy-token-0123456789abcdef';
    expect(upstreamKey(req({ 'x-api-key': SCOPED }), LOCAL, SCOPED)).toBeUndefined();
  });

  it('treats a blank x-api-key as absent', () => {
    expect(upstreamKey(req({ 'x-api-key': '  ' }), LOCAL)).toBeUndefined();
  });
});
