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
/** A minted key: 64 lowercase-or-uppercase hex characters. */
const KEY_RE = /^[0-9a-f]{64}$/i;

function readOrCreateKey({ keyPath, safeStorage, warn = () => {} }) {
  const encryptionOk = safeStorage.isEncryptionAvailable();

  if (fs.existsSync(keyPath)) {
    const stored = fs.readFileSync(keyPath);
    // A key written while the keyring was unavailable is plain utf-8, so it must
    // still be readable once the keyring comes back — otherwise a laptop that
    // booted once without a keyring would orphan its own credentials.
    if (!encryptionOk) {
      const plain = stored.toString('utf-8');
      if (KEY_RE.test(plain)) return plain;
      /*
       * ENCRYPTED FILE, KEYRING DOWN. This returned the ciphertext decoded as
       * utf-8 — a string that is not a key, handed back as though it were.
       *
       * The distinction matters because the keyring going down is usually
       * TEMPORARY. macOS returned `errAuthorizationInternal (-60008)` on one
       * boot here, `isEncryptionAvailable()` went false for that process, and
       * this handed back garbage; the dev launcher's regex rejected it and the
       * whole session ran with no credential storage, telling the user "requires
       * the desktop app" while they sat in the desktop app.
       *
       * Failing loudly is what lets the caller RETRY. Returning a wrong key
       * cannot be retried, because nothing downstream can tell it is wrong.
       */
      const err = new Error(
        `credential-master.key at ${keyPath} is encrypted and the OS keyring is unavailable — ` +
          'this is usually transient; retry before concluding the key is lost',
      );
      err.code = 'KEYRING_UNAVAILABLE';
      err.retryable = true;
      throw err;
    }
    try {
      return safeStorage.decryptString(stored);
    } catch {
      const asPlain = stored.toString('utf-8');
      if (KEY_RE.test(asPlain)) {
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
