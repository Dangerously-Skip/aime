/**
 * Web permissions for pages the app did not write.
 *
 * The browser surface's session (`persist:browser`) granted EVERY permission to
 * every site: camera, microphone, location, notifications, MIDI, HID, serial,
 * clipboard read, pointer lock. A page the agent navigated to — or one it was
 * steered to by a prompt injection — got the user's camera without a prompt,
 * because a real browser's prompt is exactly what an embedder replaces when it
 * installs a permission handler.
 *
 * Now:
 *   - a small safe set is always granted (sanitized clipboard WRITE, fullscreen)
 *   - media / geolocation / notifications ask the user, naming the origin, and the
 *     answer is remembered per origin for the session (never written to disk)
 *   - everything else is denied
 *
 * `isTrusted(origin)` (optional) recognises the app's own origin, for the
 * session that hosts the app itself — the app asks for the microphone for voice
 * input, and it is not a stranger to be prompted about.
 *
 * The prompt is injected so this module stays Electron-free and testable; in the
 * app it is a native `dialog.showMessageBox`.
 */

const ALWAYS_ALLOW = new Set(["clipboard-sanitized-write", "fullscreen"]);
// `openExternal` is a page asking to hand a link to another application
// (mailto:, zoommtg:, slack:). Chrome asks for that too.
const ASK = new Set(["media", "geolocation", "notifications", "openExternal"]);

function originOf(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    const o = new URL(url).origin;
    // Opaque origins (data:, about:blank, sandboxed frames) serialize to "null".
    // There is nobody to name in a prompt, and nobody to remember the answer for.
    return o && o !== "null" ? o : null;
  } catch {
    return null;
  }
}

/** The static part of the decision: 'allow' | 'deny' | 'ask'. */
function classifyPermission(permission, origin, isTrusted) {
  if (origin && typeof isTrusted === "function" && isTrusted(origin)) return "allow";
  if (ALWAYS_ALLOW.has(permission)) return "allow";
  if (ASK.has(permission) && origin) return "ask";
  return "deny";
}

/** Human wording for the prompt. */
function describePermission(permission, details = {}) {
  if (permission === "media") {
    const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    const wantsVideo = types.includes("video");
    const wantsAudio = types.includes("audio");
    if (wantsVideo && wantsAudio) return "use your camera and microphone";
    if (wantsVideo) return "use your camera";
    if (wantsAudio) return "use your microphone";
    return "use your camera or microphone";
  }
  if (permission === "geolocation") return "know your location";
  if (permission === "notifications") return "show notifications";
  if (permission === "openExternal") {
    let scheme = "";
    try {
      scheme = details.externalURL ? new URL(details.externalURL).protocol : "";
    } catch {
      // unparseable — describe it generically
    }
    return scheme ? `open a "${scheme.replace(/:$/, "")}:" link in another application` : "open another application";
  }
  return `use "${permission}"`;
}

/**
 * @param {{
 *   prompt: (req: { origin: string, permission: string, description: string }) => Promise<boolean>,
 *   isTrusted?: (origin: string) => boolean,
 * }} opts
 */
function createPermissionGate({ prompt, isTrusted }) {
  // `${origin} ${permission}` -> boolean. Session-scoped by construction: this
  // map dies with the process.
  const remembered = new Map();
  // One prompt per (origin, permission) at a time — a page firing ten
  // getUserMedia calls must not stack ten dialogs.
  const pending = new Map();

  async function request(permission, url, details = {}) {
    const origin = originOf(url);
    const verdict = classifyPermission(permission, origin, isTrusted);
    if (verdict !== "ask") return verdict === "allow";

    const key = `${origin} ${permission}`;
    if (remembered.has(key)) return remembered.get(key);
    if (pending.has(key)) return pending.get(key);

    const asked = (async () => {
      let granted = false;
      try {
        granted = (await prompt({ origin, permission, description: describePermission(permission, details) })) === true;
      } catch {
        granted = false;
      }
      remembered.set(key, granted);
      pending.delete(key);
      return granted;
    })();
    pending.set(key, asked);
    return asked;
  }

  /**
   * Synchronous check (`setPermissionCheckHandler`). It cannot prompt, so an
   * askable permission is granted only once the user has said yes to it.
   */
  function check(permission, url) {
    const origin = originOf(url);
    const verdict = classifyPermission(permission, origin, isTrusted);
    if (verdict !== "ask") return verdict === "allow";
    return remembered.get(`${origin} ${permission}`) === true;
  }

  return { request, check };
}

module.exports = {
  ALWAYS_ALLOW,
  ASK,
  originOf,
  classifyPermission,
  describePermission,
  createPermissionGate,
};
