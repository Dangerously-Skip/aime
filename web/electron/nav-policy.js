/**
 * Where the main window may go, and who may talk to main over IPC.
 *
 * The main window carries the preload bridge — `fsRead`, `fsWrite`, `ptyOpen`,
 * `getApiToken` and the rest. Whatever page is loaded in it gets that bridge.
 * A link in a model reply used to navigate the window straight to an external
 * site, and that site then had the bridge: read any file, write any file, open a
 * shell, and fetch the API token. So the window's origin IS the trust boundary,
 * and every decision about it lives here as a pure function, where a test can
 * hold it to the letter instead of a comment describing it.
 *
 * The app origin is exactly `http://localhost:<port>` or `http://127.0.0.1:<port>`
 * — both, because the dev launcher and the packaged server bind loopback and the
 * window loads `localhost`. Hostname and port are compared as parsed values, not
 * prefixes: `http://localhost:19532.evil.com` and `http://localhost.evil.com`
 * both begin with the app's origin string, and neither is it.
 *
 * Plain CommonJS, no Electron imports: main-web.js requires it, and so do the
 * tests, which run under Node.
 */

const APP_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Protocols handed to the OS (default browser / mail client) rather than loaded. */
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function parse(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Is `url` a page of THIS app (http, loopback host, the app's port, no userinfo)? */
function isAppUrl(url, port) {
  const u = parse(url);
  if (!u || !port) return false;
  if (u.protocol !== "http:") return false;
  if (!APP_HOSTS.has(u.hostname)) return false;
  // `new URL` drops a default port (80) to "", so an app on port 80 would never
  // match — not a configuration this app produces, and failing closed is right.
  if (u.port !== String(port)) return false;
  // `http://evil@localhost:1234` is the app's origin, but nothing legitimate
  // spells it that way.
  if (u.username || u.password) return false;
  return true;
}

/** Should `url` open in the user's default browser / mail client? */
function isExternalUrl(url) {
  const u = parse(url);
  return !!u && EXTERNAL_PROTOCOLS.has(u.protocol);
}

/**
 * A navigation of the main window's top frame (`will-navigate`, `will-redirect`).
 *
 *   'allow'    — stays inside the app
 *   'external' — hand to the OS, keep the window where it is
 *   'block'    — javascript:, file:, data:, blob:, custom schemes, garbage
 */
function classifyNavigation(url, port) {
  if (isAppUrl(url, port)) return "allow";
  if (isExternalUrl(url)) return "external";
  return "block";
}

/**
 * `window.open` / `target=_blank` from the main window.
 *
 * Never 'allow': a child BrowserWindow inherits the opener's webPreferences,
 * preload included, so allowing ANY url here hands the bridge to whatever it
 * loads. That was the old behaviour for every non-http url. External urls go to
 * the OS; everything else is refused.
 */
function windowOpenAction(url) {
  return isExternalUrl(url) ? "external" : "deny";
}

/**
 * Is an IPC message from a frame showing the app?
 *
 * `senderFrame` is null when the frame has navigated away or been destroyed
 * since sending — refuse rather than guess who it was.
 */
function isTrustedSenderUrl(frameUrl, port) {
  return isAppUrl(frameUrl, port);
}

module.exports = {
  isAppUrl,
  isExternalUrl,
  classifyNavigation,
  windowOpenAction,
  isTrustedSenderUrl,
};
