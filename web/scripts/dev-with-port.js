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

(async () => {
  const port = await findFreePort();
  console.log(`[dev-with-port] Using port ${port}`);

  const env = { ...process.env, PORT: String(port) };
  const webDir = path.join(__dirname, '..');
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
