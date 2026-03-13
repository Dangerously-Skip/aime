import { createToolMonitor, type HookConfig, type ToolMonitorResult } from './tool-monitor';
import { createCostTracker, type CostTrackerResult } from './cost-tracker';
import { createAuditLogger, type AuditLoggerResult } from './audit-logger';
import { createFileWatcher, type FileWatcherResult } from './file-watcher';

/**
 * Monitors bag returned by createSurfaceHooks.
 */
export interface SurfaceMonitors {
  toolMonitor: ToolMonitorResult;
  costTracker: CostTrackerResult;
  auditLogger: AuditLoggerResult;
  fileWatcher: FileWatcherResult;
}

export interface SurfaceHooksResult {
  hooks: HookConfig;
  monitors: SurfaceMonitors;
}

export interface SurfaceHooksOptions {
  model?: string;
  logDir?: string;
  onToolUse?: (entry: import('./tool-monitor').ToolLogEntry) => void;
}

/**
 * Merge multiple Agent SDK hook configs into a single config.
 *
 * Each hook config may define arrays under keys like `PostToolUse`.
 * This function concatenates those arrays so every hook fires.
 */
export function mergeHookConfigs(...configs: (HookConfig | null | undefined)[]): HookConfig {
  const merged: HookConfig = {};

  for (const config of configs) {
    if (!config) continue;
    for (const [hookType, matchers] of Object.entries(config)) {
      if (!merged[hookType]) {
        merged[hookType] = [];
      }
      merged[hookType]!.push(...(matchers as import('./tool-monitor').HookMatcher[]));
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
 */
export function createSurfaceHooks(
  surfaceId: string,
  chatId: string,
  options: SurfaceHooksOptions = {},
): SurfaceHooksResult {
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
export { createToolMonitor } from './tool-monitor';
export { createCostTracker } from './cost-tracker';
export { createAuditLogger } from './audit-logger';
export { createFileWatcher } from './file-watcher';

// Re-export types
export type { HookConfig, HookMatcher, PostToolUseInput, ToolLogEntry, ToolMonitorResult } from './tool-monitor';
export type { CostBreakdown, CostTrackerResult } from './cost-tracker';
export type { AuditLoggerResult } from './audit-logger';
export type { FileModification, FileWatcherResult } from './file-watcher';
