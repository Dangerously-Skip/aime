/**
 * What `electronAPI.openPath` may hand to `shell.openPath`.
 *
 * `shell.openPath` opens a path with the OS's default handler — which for an
 * `.app`, a `.command` or an `.exe` means RUNNING it. The handler used to pass
 * whatever string arrived straight through. The IPC guard already limits who
 * can call it to the app's own frames; this limits what they can ask for:
 *
 *   - a string, no NUL bytes; `~/` expanded; a `file://` URL converted (the
 *     preview panel holds `file:///…/index.html` and has no other way to open
 *     it now that window.open refuses non-http URLs — see nav-policy.js)
 *   - ABSOLUTE after that, and normalised — no relative path resolved against
 *     wherever the main process happens to be running
 *   - it EXISTS — a typo'd path is an error the caller can show, not a no-op
 *   - not something the OS would execute
 *
 * Pure apart from the injected `exists`, so it is tested without Electron.
 */
const path = require("path");
const { fileURLToPath } = require("url");

/**
 * Opened by the OS as programs, installers or scripts rather than documents.
 * Directories with these suffixes (macOS bundles) are refused too.
 */
const EXECUTABLE_EXTENSIONS = new Set([
  ".app", ".command", ".tool", ".terminal", ".workflow", ".action", ".scpt", ".applescript",
  ".pkg", ".mpkg", ".prefpane", ".kext",
  ".exe", ".com", ".bat", ".cmd", ".msi", ".msix", ".scr", ".pif", ".ps1", ".vbs", ".vbe",
  ".jse", ".wsf", ".wsh", ".hta", ".cpl", ".lnk", ".reg",
  ".jar", ".desktop", ".appimage", ".run",
]);

/**
 * Executed by Windows Script Host on double-click, but ordinary source files
 * everywhere else — where refusing them would break "open" on a generated
 * script the user wants to read.
 */
const WINDOWS_ONLY_EXECUTABLE = new Set([".js"]);

/**
 * @param {unknown} input
 * @param {{
 *   homedir: string,
 *   exists: (p: string) => boolean,
 *   isExecutableFile?: (p: string) => boolean,
 *   platform?: string,
 * }} env
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
function resolveOpenPath(input, env) {
  if (typeof input !== "string" || !input.trim()) return { ok: false, reason: "No path given" };
  if (input.includes("\0")) return { ok: false, reason: "Invalid path" };

  let p = input.trim();
  if (/^file:/i.test(p)) {
    try {
      p = fileURLToPath(p);
    } catch {
      return { ok: false, reason: "Not a local file URL" };
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    return { ok: false, reason: "Not a local path" };
  }
  if (p === "~") p = env.homedir;
  else if (p.startsWith("~/")) p = path.join(env.homedir, p.slice(2));

  const abs = (env.platform === "win32" ? path.win32 : path.posix).isAbsolute(p) || path.isAbsolute(p);
  if (!abs) return { ok: false, reason: "Path must be absolute" };
  p = path.normalize(p);

  // Every segment, not just the last: a binary INSIDE an .app bundle runs too.
  for (const segment of p.split(/[\\/]+/)) {
    const ext = path.extname(segment).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(ext) || (env.platform === "win32" && WINDOWS_ONLY_EXECUTABLE.has(ext))) {
      return { ok: false, reason: `Refusing to open ${ext} files — they run as programs` };
    }
  }
  if (!env.exists(p)) return { ok: false, reason: "File not found" };
  // An extension-less binary or a chmod +x script is handed to Terminal and run.
  if (env.isExecutableFile && env.isExecutableFile(p)) {
    return { ok: false, reason: "Refusing to open an executable file" };
  }
  return { ok: true, path: p };
}

module.exports = { resolveOpenPath, EXECUTABLE_EXTENSIONS };
