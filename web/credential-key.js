/**
 * The credential master key — one derivation, shared by every process that needs it.
 *
 * Why this is its own module rather than a function inside main-web.js:
 *
 * The key encrypts ~/.aime/credentials.enc, which holds BYOK provider keys and
 * connector tokens. The key itself lives in Electron's userData, wrapped by the
 * OS keyring via safeStorage. Those two paths have different lifecycles, so a
 * SECOND derivation that produced a different key would leave a new key sitting
 * beside old ciphertext — every stored credential unreadable, and (before the
 * read-time guard landed) every chat message failing with a GCM auth error.
 *
 * The dev launcher needs the same key the packaged app uses, so it mints it
 * through this module in a throwaway Electron process rather than re-deriving it
 * in plain node — plain node cannot open safeStorage's wrapper at all, so a node
 * implementation would necessarily disagree.
 *
 * `readOrCreateKey` takes its dependencies so it can be tested without Electron.
 */
const fs = require('fs');
const crypto = require('crypto');

/**
 * Read the master key, creating it on first run.
 *
 * @param {object} deps
 * @param {string} deps.keyPath        Absolute path to credential-master.key.
 * @param {object} deps.safeStorage    Electron's safeStorage (or a stub in tests).
 * @param {(msg: string) => void} [deps.warn]
 * @returns {string} 64-char hex key.
 */
function readOrCreateKey({ keyPath, safeStorage, warn = () => {} }) {
  const encryptionOk = safeStorage.isEncryptionAvailable();

  if (fs.existsSync(keyPath)) {
    const stored = fs.readFileSync(keyPath);
    // A key written while the keyring was unavailable is plain utf-8, so it must
    // still be readable once the keyring comes back — otherwise a laptop that
    // booted once without a keyring would orphan its own credentials.
    if (!encryptionOk) return stored.toString('utf-8');
    try {
      return safeStorage.decryptString(stored);
    } catch {
      const asPlain = stored.toString('utf-8');
      if (/^[0-9a-f]{64}$/i.test(asPlain)) {
        warn('Credential master key was stored unencrypted; re-wrapping it with the OS keyring.');
        fs.writeFileSync(keyPath, safeStorage.encryptString(asPlain), { mode: 0o600 });
        return asPlain;
      }
      throw new Error(`credential-master.key at ${keyPath} could not be decrypted`);
    }
  }

  const hex = crypto.randomBytes(32).toString('hex');
  if (!encryptionOk) {
    warn('OS keyring unavailable — credential master key stored unencrypted (0600).');
  }
  fs.writeFileSync(
    keyPath,
    encryptionOk ? safeStorage.encryptString(hex) : Buffer.from(hex, 'utf-8'),
    { mode: 0o600 },
  );
  return hex;
}

module.exports = { readOrCreateKey };
