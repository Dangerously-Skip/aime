/**
 * Keeps the packaged app's Next server alive, or says clearly that it is not.
 *
 * The server runs as a child of main. When it exited — an OOM, a native module
 * crash, an unhandled rejection in a route — main logged one line and carried
 * on, leaving a window whose every request failed. To the user the app had
 * frozen, and nothing on screen said otherwise.
 *
 * Now an unexpected exit restarts the server, up to `maxRestarts` times per
 * launch. Past that, `onFatal` is told once, and main shows an error naming the
 * log file instead of a dead window. A deliberate `stop()` (quitting) is not a
 * crash and restarts nothing.
 *
 * Electron-free: `spawn` returns anything with `on('exit')` and `kill()`, and
 * `waitReady` resolves when the server accepts connections — the tests drive
 * both with fakes; main passes `utilityProcess.fork` and a port poll.
 */

function createServerSupervisor({ spawn, waitReady, onReady, onFatal, maxRestarts = 1, log = console.error }) {
  let child = null;
  let restarts = 0;
  let stopping = false;
  let failed = false;

  function fail(reason) {
    if (failed || stopping) return;
    failed = true;
    onFatal(reason);
  }

  async function launch(isRestart) {
    let current;
    try {
      current = spawn();
    } catch (err) {
      fail(`could not start the server: ${err && err.message ? err.message : err}`);
      return;
    }
    child = current;

    current.on("exit", (code) => {
      // An exit from a process we have already replaced is old news.
      if (current !== child || stopping) return;
      child = null;
      log(`[AIME] Next.js server exited unexpectedly (code ${code}).`);
      if (restarts < maxRestarts) {
        restarts += 1;
        log(`[AIME] Restarting the server (attempt ${restarts} of ${maxRestarts}).`);
        launch(true);
      } else {
        fail(`the server exited (code ${code}) and did not recover after ${maxRestarts} restart(s)`);
      }
    });

    try {
      await waitReady();
    } catch (err) {
      if (current !== child || stopping) return;
      // Up but never listening: kill it, so the exit handler cannot also fire a
      // restart for a process we are already giving up on.
      child = null;
      try {
        current.kill();
      } catch {
        // already gone
      }
      fail(`the server did not start: ${err && err.message ? err.message : err}`);
      return;
    }
    if (current === child && !stopping) onReady({ restarted: isRestart });
  }

  return {
    start() {
      return launch(false);
    },
    /** Deliberate shutdown: an exit after this is expected. */
    stop() {
      stopping = true;
      if (child) {
        try {
          child.kill();
        } catch {
          // already gone
        }
      }
      child = null;
    },
    get restarts() {
      return restarts;
    },
  };
}

/**
 * The page shown while the server boots — a data: URL, so it needs no server,
 * no file in the bundle, and no bridge. Script-free by construction.
 */
function loadingPageUrl(appName) {
  const safe = String(appName).replace(/[<>&"']/g, "");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${safe}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
html,body{height:100%;margin:0}
body{display:flex;align-items:center;justify-content:center;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b0b0c;color:#a1a1aa;-webkit-app-region:drag}
@media (prefers-color-scheme: light){body{background:#fafafa;color:#52525b}}
.s{width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:r .8s linear infinite;margin-right:10px}
@keyframes r{to{transform:rotate(360deg)}}
</style></head><body><div class="s" role="progressbar" aria-label="Loading"></div>Starting ${safe}…</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

module.exports = { createServerSupervisor, loadingPageUrl };
