/**
 * The sidebar's feedback button: the FeedlyBackly widget when this build has a
 * key for it, GitHub Issues otherwise.
 *
 * Without a key the button did nothing at all — the widget is never loaded, so
 * `window.FeedlyBackly` is undefined and the click fell through silently. A
 * build without the key is the NORMAL case for anyone who is not us, so for
 * almost every open-source user the feedback button was dead.
 */

// FeedlyBackly widget globals
declare global {
  interface Window {
    feedlybacklySettings?: {
      apiKey: string;
      apiUrl: string;
      hideLauncher?: boolean;
      guestEnabled: boolean;
    };
    FeedlyBackly?: {
      open: () => void;
      close: () => void;
      setUser: (user: { email?: string; name?: string }) => void;
      setCustomData: (data: Record<string, unknown>) => void;
    };
  }
}

export const FEEDBACK_ISSUES_URL = 'https://github.com/Dangerously-Skip/aime/issues/new';

const WIDGET_SCRIPT_ID = 'feedlybackly-script';
const WIDGET_SRC = 'https://feedlybackly-widget.apps.dangerouslyskip.com/widget.js';
const WIDGET_API_URL = 'https://feedlybackly-api.apps.dangerouslyskip.com';

/**
 * Inject the widget — only when a key is configured.
 *
 * The key was once hardcoded, which put it in 575 commits and every shipped
 * bundle. A widget key reaching the browser is inherent (the widget calls the
 * API from the page), so the env var does not make it secret; it keeps it out
 * of a public git history. Unset means NO third-party script at all, not a
 * widget that 401s on every call.
 *
 * @returns whether the widget is (now) on the page.
 */
export function loadFeedbackWidget(apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  if (document.getElementById(WIDGET_SCRIPT_ID)) return true;
  window.feedlybacklySettings = {
    apiKey,
    apiUrl: WIDGET_API_URL,
    hideLauncher: true,
    guestEnabled: true,
  };
  const script = document.createElement('script');
  script.id = WIDGET_SCRIPT_ID;
  script.src = WIDGET_SRC;
  document.body.appendChild(script);
  return true;
}

/**
 * Open whichever feedback channel is actually available.
 *
 * Falls back to GitHub Issues when the key is set but the widget has not
 * loaded (blocked, offline, their API down) — the same dead click otherwise.
 * `window.open` rather than an IPC call: Electron's window-open handler sends
 * http(s) URLs to the system browser, and a plain browser opens a tab.
 */
export function openFeedback(opts: { apiKey: string | undefined; name?: string }): 'widget' | 'issues' {
  if (opts.apiKey && window.FeedlyBackly) {
    if (opts.name) window.FeedlyBackly.setUser({ name: opts.name });
    window.FeedlyBackly.open();
    return 'widget';
  }
  window.open(FEEDBACK_ISSUES_URL, '_blank', 'noopener,noreferrer');
  return 'issues';
}
