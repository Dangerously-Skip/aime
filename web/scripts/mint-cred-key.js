/**
 * Print the credential master key, then exit. Dev-launcher use only.
 *
 * In the packaged app, main-web.js spawns the Next server itself and hands it
 * AIME_CRED_KEY. In dev, `next dev` is a SIBLING of Electron started before it,
 * so it never inherited the key — which made every BYOK credential read and
 * write fail with "Credential storage is unavailable (requires the desktop app)"
 * while the user was sitting inside the desktop app. It also put the dev server
 * in the keyless state that leaves migrated connector entries holding the
 * ${AIME_SECRET} sentinel.
 *
 * This runs as a minimal Electron main process purely so safeStorage is
 * available: the key is wrapped by the OS keyring, and plain node cannot unwrap
 * it. Re-deriving it in node would mint a DIFFERENT key beside the existing
 * ciphertext, which is the one failure mode credential-key.js exists to prevent.
 *
 * Prints the 64-char hex key on stdout and nothing else. No window is created.
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const { readOrCreateKey } = require('../credential-key');

app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  try {
    const key = readOrCreateKey({
      keyPath: path.join(app.getPath('userData'), 'credential-master.key'),
      safeStorage,
      warn: (msg) => process.stderr.write(`[mint-cred-key] ${msg}\n`),
    });
    process.stdout.write(key);
    app.exit(0);
  } catch (err) {
    process.stderr.write(`[mint-cred-key] ${err.message}\n`);
    app.exit(1);
  }
});
