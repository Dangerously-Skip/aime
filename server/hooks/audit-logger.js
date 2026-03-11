import fs from 'fs';
import path from 'path';

/**
 * Logs all agent actions to a JSONL file.
 *
 * Creates a PostToolUse hook that appends one JSON object per line to
 * `audit.jsonl` inside the configured log directory.  Each entry contains
 * the timestamp, surface/chat identifiers, tool name, and success flag.
 *
 * The logger lazily creates the log directory on first write.
 *
 * @param {Object} options
 * @param {string} [options.logDir]    - Directory for log files (default: <cwd>/logs)
 * @param {string} [options.surfaceId] - Surface identifier
 * @param {string} [options.chatId]    - Chat session identifier
 * @returns {{ hookConfig: Object, getLogPath: Function, rotate: Function }}
 */
export function createAuditLogger(options = {}) {
  const logDir  = options.logDir || path.join(process.cwd(), 'logs');
  let logFile   = path.join(logDir, 'audit.jsonl');
  let dirReady  = false;

  /**
   * Ensure the log directory exists (idempotent).
   */
  function ensureDir() {
    if (dirReady) return;
    try {
      fs.mkdirSync(logDir, { recursive: true });
      dirReady = true;
    } catch (err) {
      console.error('[AuditLogger] Failed to create log directory:', err.message);
    }
  }

  /**
   * Append a single JSON line to the audit log.
   * Writes are synchronous to avoid interleaving in high-concurrency
   * scenarios (tool calls are sequential per-agent anyway).
   */
  function appendEntry(entry) {
    ensureDir();
    try {
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      console.error('[AuditLogger] Write failed:', err.message);
    }
  }

  const hook = async (input) => {
    const entry = {
      timestamp: new Date().toISOString(),
      surfaceId: options.surfaceId || 'unknown',
      chatId:    options.chatId    || 'unknown',
      tool_name: input.tool_name,
      success:   input.error == null,
      error:     input.error || null,
    };

    appendEntry(entry);
    return {};
  };

  return {
    hookConfig: {
      PostToolUse: [{ matcher: '.*', hooks: [hook] }],
    },

    /**
     * Get the absolute path to the current audit log file.
     * @returns {string}
     */
    getLogPath() {
      return logFile;
    },

    /**
     * Rotate the current log file by renaming it with a timestamp suffix
     * and starting a fresh file.
     * @returns {string} Path to the rotated (old) log file
     */
    rotate() {
      ensureDir();
      const timestamp  = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = path.join(logDir, `audit-${timestamp}.jsonl`);

      try {
        if (fs.existsSync(logFile)) {
          fs.renameSync(logFile, rotatedPath);
        }
      } catch (err) {
        console.error('[AuditLogger] Rotate failed:', err.message);
      }

      // Future writes go to a fresh audit.jsonl
      logFile = path.join(logDir, 'audit.jsonl');
      return rotatedPath;
    },
  };
}
