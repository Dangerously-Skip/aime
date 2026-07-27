/**
 * Dev launcher: finds a free port, starts Next.js dev server, then Electron.
 * Replaces `concurrently + wait-on` with explicit port detection to avoid
 * hardcoding port 3000 and colliding with other running Next.js projects.
 */
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

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
  const port = await findFreePort();
  console.log(`[dev-with-port] Using port ${port}`);

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
