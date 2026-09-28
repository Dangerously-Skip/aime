/**
 * First-launch setup: downloads a self-contained Python from
 * astral-sh/python-build-standalone into ~/.aime/python/, then
 * pip-installs the deps the bundled skills need (python-pptx, fpdf2,
 * Pillow, etc.) and runs `playwright install chromium` so the ppt plugin's
 * HTML-to-PNG slide rendering works without the user lifting a finger.
 *
 * Idempotent: subsequent launches detect the existing setup and skip
 * everything. Failures leave a sentinel so the next launch retries.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const https = require("https");
const { spawn } = require("child_process");

// We resolve the Python build at runtime by asking GitHub for the latest
// python-build-standalone release. That way new Python versions are picked
// up automatically and we don't ship a hardcoded URL that bit-rots.
const RELEASES_API = "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest";

function platformAssetSuffix() {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin-install_only.tar.gz";
  if (process.platform === "darwin") return "x86_64-apple-darwin-install_only.tar.gz";
  if (process.platform === "win32" && process.arch === "arm64") return "aarch64-pc-windows-msvc-install_only.tar.gz";
  if (process.platform === "win32") return "x86_64-pc-windows-msvc-install_only.tar.gz";
  if (process.arch === "arm64") return "aarch64-unknown-linux-gnu-install_only.tar.gz";
  return "x86_64-unknown-linux-gnu-install_only.tar.gz";
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "AIME-Setup", Accept: "application/vnd.github+json" } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) { reject(e); }
        });
      })
      .on("error", reject);
  });
}

async function resolvePythonAssetUrl() {
  const release = await fetchJson(RELEASES_API);
  const suffix = platformAssetSuffix();
  // Match the install_only build for cpython 3.x and our platform suffix.
  // Skip "freethreaded" builds (suffix contains "+freethreaded").
  const asset = (release.assets || []).find((a) =>
    a.name.startsWith("cpython-3.") &&
    !a.name.includes("freethreaded") &&
    a.name.endsWith(suffix)
  );
  if (!asset) throw new Error(`No python-build-standalone asset matching ${suffix} in ${release.tag_name}`);
  return { url: asset.browser_download_url, name: asset.name, tag: release.tag_name };
}

// Per-user data directory. `.quarry` is the pre-rename name, still read — see
// resolveSetupDir. Mirrors DATA_DIR_NAME / LEGACY_DATA_DIR_NAME in
// src/config/branding.ts (this file is plain CJS in the main process and cannot
// import TypeScript).
const DATA_DIR_NAME = ".aime";
const LEGACY_DATA_DIR_NAME = ".quarry";

function pythonExeIn(pythonDir, platform = process.platform) {
  return platform === "win32"
    ? path.join(pythonDir, "python.exe")
    : path.join(pythonDir, "bin", "python3");
}

function isCompleteAt(dir) {
  return fs.existsSync(path.join(dir, ".setup-complete")) && fs.existsSync(pythonExeIn(path.join(dir, "python")));
}

/**
 * pip writes each console script (`pip`, `pip3`, `playwright`, …) with the
 * interpreter's ABSOLUTE path in its shebang. Moving the directory therefore
 * leaves `python3` itself working and every script beside it failing with "bad
 * interpreter" — and the server's own data-dir migration (lib/app-paths.ts) has
 * been moving this directory since the rename. Rewrites the header of any script
 * in `binDir` that still points at `fromDir`. Idempotent and cheap: it reads 512
 * bytes of each file and rewrites only the ones that match. POSIX only — on
 * Windows pip's launchers are .exe files with the path compiled in; `python -m
 * pip` still works there.
 */
function repairMovedScripts(binDir, fromDir, toDir) {
  let repaired = 0;
  let entries;
  try {
    entries = fs.readdirSync(binDir, { withFileTypes: true });
  } catch {
    return repaired;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(binDir, entry.name);
    try {
      const fd = fs.openSync(file, "r");
      const head = Buffer.alloc(512);
      const n = fs.readSync(fd, head, 0, 512, 0);
      fs.closeSync(fd);
      const text = head.subarray(0, n).toString("latin1");
      if (!text.startsWith("#!") || !text.includes(fromDir)) continue;
      const content = fs.readFileSync(file, "utf-8");
      // Only the header: the first three lines cover both pip script forms
      // (`#!<python>` and the `#!/bin/sh` + `'''exec' "<python>"` trampoline).
      const lines = content.split("\n");
      for (let i = 0; i < Math.min(3, lines.length); i++) {
        lines[i] = lines[i].split(fromDir).join(toDir);
      }
      fs.writeFileSync(file, lines.join("\n"));
      repaired++;
    } catch {
      // Unreadable or read-only — leave it; the interpreter itself still works.
    }
  }
  return repaired;
}

/**
 * Where the managed Python lives: `~/.aime`, migrated from `~/.quarry`.
 *
 *   - only `~/.quarry` exists      → rename it to `~/.aime` (same volume, instant)
 *   - setup complete only in the legacy dir (both dirs exist — the server made
 *     `~/.aime` first, or the rename failed) → keep using `~/.quarry` rather than
 *     download ~300 MB again
 *   - otherwise                    → `~/.aime`
 *
 * Must run in the main process BEFORE the Next server starts: the server's own
 * migration renames `~/.quarry` on first touch, and this module computed its
 * paths at require time — so the Python path handed to the server pointed at a
 * directory the server then moved away, and the next launch re-ran setup.
 */
function resolveSetupDir(home = os.homedir()) {
  const current = path.join(home, DATA_DIR_NAME);
  const legacy = path.join(home, LEGACY_DATA_DIR_NAME);
  try {
    if (!fs.existsSync(current) && fs.existsSync(legacy)) {
      fs.renameSync(legacy, current);
    }
  } catch {
    // best-effort; fall through to whichever directory has a working install
  }
  if (!isCompleteAt(current) && isCompleteAt(legacy)) return legacy;
  if (process.platform !== "win32" && isCompleteAt(current)) {
    repairMovedScripts(path.join(current, "python", "bin"), path.join(legacy, "python"), path.join(current, "python"));
  }
  return current;
}

const DATA_DIR = path.join(os.homedir(), DATA_DIR_NAME);

// Resolved on first use, not at require time: resolving can rename a directory
// in the user's home, which is not something `require` should do as a side
// effect (a test importing this module would migrate the developer's own data).
let setupDirCache = null;
function setupDir() {
  if (!setupDirCache) setupDirCache = resolveSetupDir();
  return setupDirCache;
}
const pythonDir = () => path.join(setupDir(), "python");
const playwrightDir = () => path.join(setupDir(), "playwright-browsers");
const sentinel = () => path.join(setupDir(), ".setup-complete");

function pythonExe() {
  return pythonExeIn(pythonDir());
}

function isSetupComplete() {
  return fs.existsSync(sentinel()) && fs.existsSync(pythonExe());
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const followRedirect = (currentUrl, depth = 0) => {
      if (depth > 5) return reject(new Error("Too many redirects"));
      https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return followRedirect(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        const file = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (onProgress && total > 0) onProgress(received / total);
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      }).on("error", reject);
    };
    followRedirect(url);
  });
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (opts.onStdout) opts.onStdout(d.toString());
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (opts.onStderr) opts.onStderr(d.toString());
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr || stdout}`));
    });
  });
}

/**
 * Run setup. `report` receives { phase, percent?, detail? } updates.
 * Resolves on success, rejects on failure (caller decides whether to
 * retry, surface an error card, or proceed degraded).
 */
async function runSetup(report) {
  await fsp.mkdir(setupDir(), { recursive: true });

  // Phase 1: resolve + download Python tarball
  report({ phase: "download-python", detail: "Resolving Python release…" });
  const { url, name: assetName, tag } = await resolvePythonAssetUrl();
  report({ phase: "download-python", percent: 0, detail: "Downloading Python runtime…" });
  const tarPath = path.join(setupDir(), assetName);
  await downloadFile(url, tarPath, (p) =>
    report({ phase: "download-python", percent: p, detail: `Downloading Python… ${(p * 100).toFixed(0)}%` })
  );

  // Phase 2: extract. python-build-standalone's tarball is gzipped tar with
  // a `python/` root directory. tar(1) is on every platform we care about
  // (Windows 10+ ships bsdtar, macOS has it natively).
  report({ phase: "extract-python", detail: "Extracting Python runtime…" });
  if (fs.existsSync(pythonDir())) {
    await fsp.rm(pythonDir(), { recursive: true, force: true });
  }
  await runCommand("tar", ["-xzf", tarPath, "-C", setupDir()]);
  await fsp.rm(tarPath, { force: true });
  if (!fs.existsSync(pythonExe())) {
    throw new Error(`Python not found at ${pythonExe()} after extract`);
  }

  // Phase 3: pip-install the skill deps. fpdf2 for the pdf skill, python-pptx +
  // PyYAML + Jinja2 + Pillow + pdf2image for the ppt plugin and powerpoint-control.
  report({ phase: "install-deps", percent: 0, detail: "Installing PDF and PowerPoint libraries…" });
  const pipArgs = [
    "-m", "pip", "install",
    "--no-warn-script-location",
    "--disable-pip-version-check",
    "fpdf2",
    "python-pptx",
    "PyYAML",
    "Jinja2",
    "Pillow",
    "pdf2image",
    "playwright",
  ];
  await runCommand(pythonExe(), pipArgs, {
    onStderr: (text) => {
      // pip prints download progress to stderr in newer versions
      const match = text.match(/Collecting (\S+)/);
      if (match) report({ phase: "install-deps", detail: `Installing ${match[1]}…` });
    },
  });

  // Phase 4: chromium for the ppt plugin's HTML-to-PNG slide rendering. ~250MB.
  // PLAYWRIGHT_BROWSERS_PATH points it at our managed dir, not the user's
  // ~/Library/Caches/ms-playwright (avoids polluting their global cache).
  report({ phase: "install-chromium", detail: "Installing Chromium for slide rendering…" });
  await runCommand(pythonExe(), ["-m", "playwright", "install", "chromium"], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: playwrightDir() },
  });

  // Mark complete
  await fsp.writeFile(sentinel(), JSON.stringify({
    completedAt: new Date().toISOString(),
    pythonRelease: tag,
    pythonAsset: assetName,
  }), "utf-8");

  report({ phase: "complete", percent: 1, detail: "Setup complete." });
}

module.exports = {
  isSetupComplete,
  runSetup,
  DATA_DIR,
  pythonDir,
  playwrightDir,
  pythonExe,
  // exported for tests
  resolveSetupDir,
  repairMovedScripts,
};
