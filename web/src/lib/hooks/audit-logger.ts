import fs from 'fs';
import path from 'path';
import type { PostToolUseInput, HookConfig } from './tool-monitor';

export interface AuditLoggerOptions {
  logDir?: string;
  surfaceId?: string;
  chatId?: string;
}

export interface AuditLoggerResult {
  hookConfig: HookConfig;
  getLogPath: () => string;
  rotate: () => string;
}

/**
 * Logs all agent actions to a JSONL file.
 *
 * Creates a PostToolUse hook that appends one JSON object per line to
 * `audit.jsonl` inside the configured log directory. Each entry contains
 * the timestamp, surface/chat identifiers, tool name, and success flag.
 *
 * The logger lazily creates the log directory on first write.
 */
export function createAuditLogger(options: AuditLoggerOptions = {}): AuditLoggerResult {
  const logDir = options.logDir || path.join(process.cwd(), 'logs');
  let logFile = path.join(logDir, 'audit.jsonl');
  let dirReady = false;

  /**
   * Ensure the log directory exists (idempotent).
   */
  function ensureDir(): void {
    if (dirReady) return;
    try {
      fs.mkdirSync(logDir, { recursive: true });
      dirReady = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[AuditLogger] Failed to create log directory:', message);
    }
  }

  /**
   * Append a single JSON line to the audit log.
   * Writes are synchronous to avoid interleaving in high-concurrency
   * scenarios (tool calls are sequential per-agent anyway).
   */
  function appendEntry(entry: Record<string, unknown>): void {
    ensureDir();
    try {
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[AuditLogger] Write failed:', message);
    }
  }

  const hook = async (input: PostToolUseInput): Promise<Record<string, unknown>> => {
    const entry = {
      timestamp: new Date().toISOString(),
      surfaceId: options.surfaceId || 'unknown',
      chatId: options.chatId || 'unknown',
      tool_name: input.tool_name,
      success: input.error == null,
      error: input.error || null,
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
     */
    getLogPath(): string {
      return logFile;
    },

    /**
     * Rotate the current log file by renaming it with a timestamp suffix
     * and starting a fresh file.
     */
    rotate(): string {
      ensureDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = path.join(logDir, `audit-${timestamp}.jsonl`);

      try {
        if (fs.existsSync(logFile)) {
          fs.renameSync(logFile, rotatedPath);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[AuditLogger] Rotate failed:', message);
      }

      // Future writes go to a fresh audit.jsonl
      logFile = path.join(logDir, 'audit.jsonl');
      return rotatedPath;
    },
  };
}
