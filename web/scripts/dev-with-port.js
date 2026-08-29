/**
 * Dev launcher: finds a free port, starts Next.js dev server, then Electron.
 * Replaces `concurrently + wait-on` with explicit port detection to avoid
 * hardcoding port 3000 and colliding with other running Next.js projects.
 */
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

/**
 * The dev renderer must keep the SAME origin between launches.
 *
 * localStorage is scoped per origin, so `http://localhost:54321` and
 * `http://localhost:61003` are separate stores. Picking a free port every launch
 * therefore handed the app a blank profile every time: name, providers,
 * onboarding and conversations all "reset", while ~/.aime/credentials.enc — which
 * is server-side and NOT origin-scoped — kept accumulating a fresh copy of the
 * API key per run.
 *
 * main-web.js already pins 19532 for packaged builds, with the comment "so
 * localStorage persists across launches". Dev simply never got the same
 * treatment. 19533 keeps dev distinct from a packaged install running alongside.
 */
const PREFERRED_DEV_PORT = 19533;

function canBind(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function findFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeout = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.on('connect', () => { socket.destroy(); resolve(); });
      socket.on('error', () => {
        if (Date.now() - start > timeout) {
          return reject(new Error(`Timed out waiting for port ${port}`));
        }
        setTimeout(attempt, 300);
      });
    }
    attempt();
  });
}

/**
 * Mint the credential master key in a throwaway Electron process.
 *
 * `next dev` is started here as a SIBLING of Electron, so — unlike the packaged
 * app, where main-web.js spawns the server itself and injects AIME_CRED_KEY —
 * it would otherwise run with no key at all. Every BYOK credential read and
 * write then 503s with "Credential storage is unavailable (requires the desktop
 * app)" while the user is sitting inside the desktop app, and the keyless server
 * is also what leaves migrated connector entries holding the ${AIME_SECRET}
 * sentinel.
 *
 * Electron is required because the key is wrapped by the OS keyring; see
 * credential-key.js for why re-deriving it in plain node would be harmful rather
 * than merely inconvenient.
 *
 * Failure is non-fatal and reported: dev still boots, credentials stay unavailable.
 */
function mintOnce(webDir) {
  return new Promise((resolve) => {
    let electronBin;
    try {
      electronBin = require('electron');
    } catch (e) {
      return resolve({ key: null, reason: `electron not installed: ${e.message}` });
    }
    const proc = spawn(electronBin, [path.join(__dirname, 'mint-cred-key.js')], {
      // stderr CAPTURED, not inherited. It used to go straight to the console,
      // where Chromium's own noise buried it — the run that prompted this
      // printed a macOS `errAuthorizationInternal (-60008)` keychain error four
      // lines above "Could not mint", and the two read as unrelated.
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: webDir,
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => resolve({ key: null, reason: e.message }));
    proc.on('close', (code) => {
      /*
       * SCAN for the key rather than requiring stdout to be exactly it.
       * Electron writes to stdout when it feels like it, and an exact match
       * turns any stray line into "no credentials for this whole session".
       */
      const found = out.match(/[0-9a-f]{64}/i);
      resolve(
        found
          ? { key: found[0], reason: null }
          : { key: null, reason: err.trim() || `exit ${code} with no key on stdout` },
      );
    });
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Mint the credential master key, RETRYING — because the failure is transient.
 *
 * One attempt used to decide the whole session. macOS returned
 * `errAuthorizationInternal (-60008)` from the keychain on a single boot,
 * `safeStorage` went unavailable for that process, no key was minted, and every
 * BYOK read and write 503'd for hours with "Credential storage is unavailable
 * (requires the desktop app)" — while the user was inside the desktop app,
 * looking at a key they had just pasted.
 *
 * Nothing about that state is recoverable from the UI: the server is a sibling
 * process started before Electron and has no way to be handed a key later, so a
 * blip at second zero costs a full restart the user has no reason to suspect.
 * Three tries a second apart is cheap insurance against an OS hiccup.
 */
async function mintCredentialKey(webDir) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await mintOnce(webDir);
    if (result.key) {
      if (attempt > 1) {
        console.log(`[dev-with-port] Credential master key minted on attempt ${attempt}`);
      }
      return result.key;
    }
    last = result.reason;
    if (attempt < 3) await delay(attempt * 1000);
  }
  return { failed: true, reason: last };
}

(async () => {
  let port = PREFERRED_DEV_PORT;
  if (await canBind(PREFERRED_DEV_PORT)) {
    console.log(`[dev-with-port] Using port ${port}`);
  } else if (process.env.AIME_ALLOW_ANY_PORT === '1') {
    port = await findFreePort();
    console.warn(
      `[dev-with-port] Port ${PREFERRED_DEV_PORT} is busy — using ${port} because ` +
      `AIME_ALLOW_ANY_PORT=1.\n` +
      `[dev-with-port] localStorage is per-origin, so this session starts with an ` +
      `EMPTY profile and anything saved in it is stranded under port ${port}.`,
    );
  } else {
    /**
     * Refuse, rather than silently start on another origin.
     *
     * A warning was not enough. localStorage is keyed by origin, so a different
     * port is a different profile: the app boots into onboarding with no
     * settings, no providers and no conversations, and anything saved that
     * session is stranded there forever. This profile accumulated ten such
     * origins before anyone worked out why onboarding kept reappearing — the
     * settings ended up under one port and the conversations under another,
     * which reads as data loss and is really an addressing problem.
     *
     * A dev server that does not start is an obvious, one-line problem. A dev
     * server that starts with someone's profile invisible is a confusing one
     * that costs an afternoon, so this fails closed.
     */
    console.error(
      `\n[dev-with-port] Port ${PREFERRED_DEV_PORT} is already in use, so refusing to start.\n\n` +
      `  localStorage is per-origin: starting on a different port gives the app a\n` +
      `  BLANK profile — no settings, no API keys, no conversations — and strands\n` +
      `  anything you save under that port.\n\n` +
      `  Free it:            lsof -tiTCP:${PREFERRED_DEV_PORT} -sTCP:LISTEN | xargs kill\n` +
      `  Or accept a blank profile:  AIME_ALLOW_ANY_PORT=1 npm run electron:dev\n`,
    );
    process.exit(1);
  }

  const webDir = path.join(__dirname, '..');

  const minted = await mintCredentialKey(webDir);
  const credKey = typeof minted === 'string' ? minted : null;
  if (credKey) {
    console.log('[dev-with-port] Credential master key ready — BYOK storage enabled');
  } else {
    // The REASON, and what it costs. "Could not mint" on its own sent someone
    // looking at API-key settings instead of at the keychain.
    console.warn(
      `\n[dev-with-port] Could not mint the credential master key after 3 attempts.\n` +
      `  Reason: ${(minted && minted.reason) || 'unknown'}\n` +
      `  Saving or reading BYOK API keys will fail for this session with\n` +
      `  "Credential storage is unavailable". Quit and re-run \`npm run electron:dev\`;\n` +
      `  if it persists, the OS keyring is refusing this app.\n`,
    );
  }

  // The local API's launch token. Minted here rather than in main-web.js
  // because in dev THIS process starts the Next server, and both halves must
  // agree on one value or the Electron window can never authenticate. Exported
  // into our own env so the electron child inherits the same token.
  const apiToken =
    process.env.AIME_API_TOKEN || require('crypto').randomBytes(32).toString('hex');
  process.env.AIME_API_TOKEN = apiToken;

  const env = {
    ...process.env,
    PORT: String(port),
    AIME_API_TOKEN: apiToken,
    ...(credKey ? { AIME_CRED_KEY: credKey } : {}),
  };
  const nextBin = path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');

  const next = spawn('node', [nextBin, 'dev', '-p', String(port)], {
    stdio: 'inherit',
    env,
    cwd: webDir,
  });

  next.on('error', (err) => {
    console.error('[dev-with-port] Failed to start Next.js:', err);
    process.exit(1);
  });

  console.log(`[dev-with-port] Waiting for Next.js on port ${port}…`);
  try {
    await waitForPort(port);
  } catch (err) {
    console.error('[dev-with-port]', err.message);
    next.kill();
    process.exit(1);
  }

  console.log('[dev-with-port] Next.js ready — launching Electron');
  const electronBin = require('electron');
  const electron = spawn(electronBin, [webDir], {
    stdio: 'inherit',
    env,
    cwd: webDir,
  });

  electron.on('error', (err) => {
    console.error('[dev-with-port] Failed to start Electron:', err);
    next.kill();
    process.exit(1);
  });

  electron.on('close', (code) => {
    next.kill();
    process.exit(code ?? 0);
  });

  /**
   * If the server dies, the window must not outlive it.
   *
   * `code !== null` was the whole bug: Node reports `null` when a child is
   * killed by a SIGNAL, which is precisely how `next dev` dies in practice —
   * the OOM killer under memory pressure, or a stray `kill`. Both fell through
   * this condition silently, leaving an Electron window pointing at a dead
   * origin. Every request then hangs with no error, which reads as the app
   * having frozen; the actual event happened minutes or hours earlier and was
   * never reported.
   *
   * A clean `code === 0` gets the same treatment. `next dev` exiting 0 on its
   * own is not a normal event either, and the window is just as dead after it.
   */
  next.on('close', (code, signal) => {
    console.error(
      `\n[dev-with-port] The Next.js dev server exited (${
        signal ? `killed by ${signal}` : `code ${code}`
      }).\n` +
      `  Closing the app window too — it would otherwise sit there looking frozen,\n` +
      `  because every request goes to a server that is no longer running.\n` +
      (signal === 'SIGKILL'
        ? `  SIGKILL usually means the OS ran out of memory. Check swap before relaunching.\n`
        : ''),
    );
    electron.kill();
    process.exit(code ?? 1);
  });
})();
