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
function mintCredentialKey(webDir) {
  return new Promise((resolve) => {
    let electronBin;
    try {
      electronBin = require('electron');
    } catch {
      return resolve(null);
    }
    const proc = spawn(electronBin, [path.join(__dirname, 'mint-cred-key.js')], {
      stdio: ['ignore', 'pipe', 'inherit'],
      cwd: webDir,
    });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const key = out.trim();
      resolve(/^[0-9a-f]{64}$/i.test(key) ? key : null);
    });
  });
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

  const credKey = await mintCredentialKey(webDir);
  if (credKey) {
    console.log('[dev-with-port] Credential master key ready — BYOK storage enabled');
  } else {
    console.warn('[dev-with-port] Could not mint the credential master key — saving API keys will fail');
  }

  const env = {
    ...process.env,
    PORT: String(port),
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

  next.on('close', (code) => {
    if (code !== 0 && code !== null) {
      electron.kill();
      process.exit(code);
    }
  });
})();
