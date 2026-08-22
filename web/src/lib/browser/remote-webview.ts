import type { WebviewRef } from '../browser-tools';

/**
 * A `WebviewRef` backed by a browser in ANOTHER PROCESS.
 *
 * WHY THIS SHAPE. Every one of the eighteen browser tools is written against
 * `WebviewRef`, and `executeToolInWebview` is the only implementation of them.
 * Anything that satisfies that interface inherits the whole toolset — the ref
 * scripts, the loop detector, the stale-ref refusal — with no second copy to
 * drift. So the job here is not to reimplement browsing; it is to make a remote
 * browser look like a local one.
 *
 * WHY IT HAS TO BE REMOTE. Scheduled work runs in the Next server, which Electron
 * forks as a `utilityProcess` — and a utility process cannot create a
 * `BrowserWindow`. Relaying through the renderer, the way document printing
 * does, fails for the case that matters: the widget scheduler exists so a
 * refresh works with the WINDOW CLOSED ("on macOS the app keeps running in the
 * dock"). A browser that needs an open window is no use to work that runs
 * because the window is shut.
 *
 * So the main process owns the browser and this forwards to it.
 *
 * THE TRANSPORT IS INJECTED, so everything here is testable without Electron and
 * without a second process. The real transport is a message channel to main; a
 * test passes a function.
 */

/** One request to the process that owns the browser. */
export interface RemoteCall {
  /** Which browser — one per run, so two runs cannot steer each other's page. */
  sessionId: string;
  method: 'executeJavaScript' | 'loadURL' | 'goBack' | 'goForward' | 'reload' | 'getURL' | 'capturePage';
  args: unknown[];
}

export type RemoteTransport = (call: RemoteCall) => Promise<unknown>;

/**
 * `getURL` is SYNCHRONOUS on the interface, because an Electron `<webview>`
 * answers it from memory. Across a process boundary nothing is synchronous, so
 * the URL is cached: every `loadURL` and every navigation result updates it, and
 * `getURL` returns the last known value.
 *
 * The alternative was changing `WebviewRef.getURL` to return a promise, which
 * would have rippled into every tool and every existing caller for the benefit
 * of one host. A cache that is refreshed on the operations that move the page is
 * the smaller lie, and it is only ever wrong between a navigation the PAGE
 * initiated and the next tool call — which the tools already handle, because
 * that is exactly what change observation is for.
 */
export class RemoteWebview implements WebviewRef {
  private lastUrl = '';

  constructor(
    private readonly sessionId: string,
    private readonly send: RemoteTransport,
  ) {}

  private call(method: RemoteCall['method'], ...args: unknown[]): Promise<unknown> {
    return this.send({ sessionId: this.sessionId, method, args });
  }

  async executeJavaScript(code: string): Promise<unknown> {
    return this.call('executeJavaScript', code);
  }

  async loadURL(url: string): Promise<void> {
    this.lastUrl = url;
    await this.call('loadURL', url);
    // The page may have redirected; ask rather than assume.
    await this.refreshUrl();
  }

  goBack(): void {
    void this.call('goBack').then(() => this.refreshUrl());
  }

  goForward(): void {
    void this.call('goForward').then(() => this.refreshUrl());
  }

  reload(): void {
    void this.call('reload');
  }

  getURL(): string {
    return this.lastUrl;
  }

  async capturePage(): Promise<{ toDataURL: () => string }> {
    const dataUrl = await this.call('capturePage');
    const text = typeof dataUrl === 'string' ? dataUrl : '';
    return { toDataURL: () => text };
  }

  /** Pull the real URL across and cache it. Failures leave the cache alone. */
  async refreshUrl(): Promise<string> {
    try {
      const url = await this.call('getURL');
      if (typeof url === 'string' && url) this.lastUrl = url;
    } catch {
      // A dead session must not blank the last known URL — the caller is about
      // to get an error from its next real call, which says more.
    }
    return this.lastUrl;
  }
}
