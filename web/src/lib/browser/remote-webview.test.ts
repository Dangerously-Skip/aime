// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteWebview, type RemoteCall } from './remote-webview';
import { executeToolInWebview } from '../browser-tools';

/**
 * A REMOTE BROWSER MUST BE INDISTINGUISHABLE FROM A LOCAL ONE.
 *
 * The whole value of this class is that `executeToolInWebview` — the single
 * implementation of all eighteen tools — cannot tell the difference. If it can,
 * we have two browsing implementations, which is this codebase's most repeated
 * injury and the thing DR-23 was written to avoid.
 *
 * So the load-bearing test is not "does it forward a method". It is: drive the
 * REAL tool executor against one of these and check the right calls cross the
 * wire.
 */

let calls: RemoteCall[];
let reply: (call: RemoteCall) => unknown;

const make = () =>
  new RemoteWebview('sess-1', async (call) => {
    calls.push(call);
    return reply(call);
  });

beforeEach(() => {
  calls = [];
  reply = () => undefined;
});

describe('it satisfies WebviewRef', () => {
  it('forwards each method with its session and arguments', async () => {
    const wv = make();
    await wv.executeJavaScript('1+1');
    expect(calls.at(-1)).toEqual({ sessionId: 'sess-1', method: 'executeJavaScript', args: ['1+1'] });
  });

  it('keeps sessions apart, so two runs cannot steer each other', async () => {
    /*
     * One browser per run. Without the session id, a nightly fan-out would have
     * every run driving whichever page moved last.
     */
    const a = new RemoteWebview('run-a', async (c) => void calls.push(c));
    const b = new RemoteWebview('run-b', async (c) => void calls.push(c));
    await a.executeJavaScript('a');
    await b.executeJavaScript('b');
    expect(calls.map((c) => c.sessionId)).toEqual(['run-a', 'run-b']);
  });
});

describe('getURL, which the interface makes synchronous', () => {
  it('reports the URL after a load', async () => {
    reply = (c) => (c.method === 'getURL' ? 'https://example.com/landed' : undefined);
    const wv = make();
    await wv.loadURL('https://example.com');
    // The REAL url, not the requested one: a redirect must not leave the tools
    // reasoning about a page that never rendered.
    expect(wv.getURL()).toBe('https://example.com/landed');
  });

  it('falls back to the requested URL when the remote cannot say', async () => {
    reply = () => undefined;
    const wv = make();
    await wv.loadURL('https://example.com/x');
    expect(wv.getURL()).toBe('https://example.com/x');
  });

  it('a failed refresh does not blank the last known URL', async () => {
    const wv = make();
    reply = (c) => (c.method === 'getURL' ? 'https://good.example/' : undefined);
    await wv.loadURL('https://good.example');
    reply = () => { throw new Error('session died'); };
    await wv.refreshUrl();
    expect(wv.getURL()).toBe('https://good.example/');
  });

  it('starts empty rather than lying', () => {
    expect(make().getURL()).toBe('');
  });
});

describe('the real tool executor drives it — the point of the class', () => {
  /*
   * Not "did it forward a method" but "does the one implementation of the tools
   * work against it unchanged". Anything less and the remote host is a second
   * browsing implementation waiting to drift.
   */
  it('navigate reaches the remote as loadURL', async () => {
    reply = (c) => (c.method === 'getURL' ? 'https://example.com/' : undefined);
    const wv = make();
    const result = await executeToolInWebview(wv, 'navigate', { url: 'https://example.com' });
    expect(result.success).toBe(true);
    expect(calls.map((c) => c.method)).toContain('loadURL');
  });

  it('snapshot injects the real marking script over the wire', async () => {
    let injected = '';
    reply = (c) => {
      if (c.method === 'executeJavaScript') {
        injected = String(c.args[0]);
        return 'Snapshot 1 — 0 interactive elements.';
      }
      return undefined;
    };
    const wv = make();
    await executeToolInWebview(wv, 'snapshot', {});
    // The same script the local path uses — refs and all.
    expect(injected).toContain('markInteractive');
    expect(injected).toContain('data-agent-ref');
  });

  it('click sends the resolver, so a stale ref refuses remotely too', async () => {
    let injected = '';
    reply = (c) => {
      if (c.method === 'executeJavaScript') {
        injected = String(c.args[0]);
        return { success: false, message: 'stale' };
      }
      return undefined;
    };
    const wv = make();
    await executeToolInWebview(wv, 'click', { ref: '1:3' });
    expect(injected).toContain('resolveRef');
    expect(injected).toContain('1:3');
  });

  it('a transport failure becomes a tool error, not a thrown turn', async () => {
    // The run must survive a dead session: an error it can read beats an
    // exception that ends the turn and loses everything already done.
    reply = () => { throw new Error('utility process is gone'); };
    const wv = make();
    const result = await executeToolInWebview(wv, 'navigate', { url: 'https://example.com' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/utility process is gone/);
  });
});
