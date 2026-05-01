/**
 * First-launch setup: downloads a self-contained Python from
 * astral-sh/python-build-standalone into ~/.quarry/python/, then
 * pip-installs the deps the bundled skills need (python-pptx, fpdf2,
 * Pillow, etc.) and runs `playwright install chromium` so nib-ppt's
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
      .get(url, { headers: { "User-Agent": "Quarry-Setup", Accept: "application/vnd.github+json" } }, (res) => {
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

const QUARRY_DIR = path.join(os.homedir(), ".quarry");
const PYTHON_DIR = path.join(QUARRY_DIR, "python");
const PLAYWRIGHT_DIR = path.join(QUARRY_DIR, "playwright-browsers");
const SENTINEL = path.join(QUARRY_DIR, ".setup-complete");

function pythonExe() {
  return process.platform === "win32"
    ? path.join(PYTHON_DIR, "python.exe")
    : path.join(PYTHON_DIR, "bin", "python3");
}

function isSetupComplete() {
  return fs.existsSync(SENTINEL) && fs.existsSync(pythonExe());
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
  await fsp.mkdir(QUARRY_DIR, { recursive: true });

  // Phase 1: resolve + download Python tarball
  report({ phase: "download-python", detail: "Resolving Python release…" });
  const { url, name: assetName, tag } = await resolvePythonAssetUrl();
  report({ phase: "download-python", percent: 0, detail: "Downloading Python runtime…" });
  const tarPath = path.join(QUARRY_DIR, assetName);
  await downloadFile(url, tarPath, (p) =>
    report({ phase: "download-python", percent: p, detail: `Downloading Python… ${(p * 100).toFixed(0)}%` })
  );

  // Phase 2: extract. python-build-standalone's tarball is gzipped tar with
  // a `python/` root directory. tar(1) is on every platform we care about
  // (Windows 10+ ships bsdtar, macOS has it natively).
  report({ phase: "extract-python", detail: "Extracting Python runtime…" });
  if (fs.existsSync(PYTHON_DIR)) {
    await fsp.rm(PYTHON_DIR, { recursive: true, force: true });
  }
  await runCommand("tar", ["-xzf", tarPath, "-C", QUARRY_DIR]);
  await fsp.rm(tarPath, { force: true });
  if (!fs.existsSync(pythonExe())) {
    throw new Error(`Python not found at ${pythonExe()} after extract`);
  }

  // Phase 3: pip-install the skill deps. fpdf2 for nib-pdf, python-pptx +
  // PyYAML + Jinja2 + Pillow + pdf2image for nib-ppt and powerpoint-control.
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

  // Phase 4: chromium for nib-ppt's HTML-to-PNG slide rendering. ~250MB.
  // PLAYWRIGHT_BROWSERS_PATH points it at our managed dir, not the user's
  // ~/Library/Caches/ms-playwright (avoids polluting their global cache).
  report({ phase: "install-chromium", detail: "Installing Chromium for slide rendering…" });
  await runCommand(pythonExe(), ["-m", "playwright", "install", "chromium"], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: PLAYWRIGHT_DIR },
  });

  // Mark complete
  await fsp.writeFile(SENTINEL, JSON.stringify({
    completedAt: new Date().toISOString(),
    pythonRelease: tag,
    pythonAsset: assetName,
  }), "utf-8");

  report({ phase: "complete", percent: 1, detail: "Setup complete." });
}

module.exports = {
  isSetupComplete,
  runSetup,
  PYTHON_DIR,
  PLAYWRIGHT_DIR,
  pythonExe,
};
