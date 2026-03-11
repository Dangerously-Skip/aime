import { createToolMonitor } from './tool-monitor.js';
import { createCostTracker } from './cost-tracker.js';
import { createAuditLogger } from './audit-logger.js';
import { createFileWatcher } from './file-watcher.js';

/**
 * Merge multiple Agent SDK hook configs into a single config.
 *
 * Each hook config may define arrays under keys like `PostToolUse`.
 * This function concatenates those arrays so every hook fires.
 *
 * @param  {...Object} configs - Individual hook config objects
 * @returns {Object} Merged hook config
 */
export function mergeHookConfigs(...configs) {
  const merged = {};

  for (const config of configs) {
    if (!config) continue;
    for (const [hookType, matchers] of Object.entries(config)) {
      if (!merged[hookType]) {
        merged[hookType] = [];
      }
      merged[hookType].push(...matchers);
    }
  }

  return merged;
}

/**
 * Create a complete set of hooks for a surface/chat session.
 *
 * Instantiates all individual hooks (tool monitor, cost tracker, audit
 * logger, file watcher) with shared surface/chat context, then merges
 * their Agent SDK hook configs into a single object ready to pass to
 * the `query()` call.
 *
 * @param {string} surfaceId - Surface identifier (chat, cowork, code, etc.)
 * @param {string} chatId    - Chat session identifier
 * @param {Object} [options]
 * @param {string}   [options.model]      - Model name for cost estimation
 * @param {string}   [options.logDir]     - Directory for audit logs
 * @param {Function} [options.onToolUse]  - Real-time tool use callback
 * @returns {{ hooks: Object, monitors: Object }}
 */
export function createSurfaceHooks(surfaceId, chatId, options = {}) {
  const shared = { surfaceId, chatId };

  const toolMonitor = createToolMonitor({
    ...shared,
    onToolUse: options.onToolUse,
  });

  const costTracker = createCostTracker({
    ...shared,
    model: options.model,
  });

  const auditLogger = createAuditLogger({
    ...shared,
    logDir: options.logDir,
  });

  const fileWatcher = createFileWatcher({
    ...shared,
  });

  const hooks = mergeHookConfigs(
    toolMonitor.hookConfig,
    costTracker.hookConfig,
    auditLogger.hookConfig,
    fileWatcher.hookConfig,
  );

  return {
    hooks,
    monitors: {
      toolMonitor,
      costTracker,
      auditLogger,
      fileWatcher,
    },
  };
}

// Re-export individual factories for direct use
export { createToolMonitor } from './tool-monitor.js';
export { createCostTracker } from './cost-tracker.js';
export { createAuditLogger } from './audit-logger.js';
export { createFileWatcher } from './file-watcher.js';
