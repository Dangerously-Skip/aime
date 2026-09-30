/**
 * Next.js instrumentation hook — runs once on server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // pino is a Node-only dependency; only load and use it in the Node runtime.
  const isNodeRuntime = process.env['NEXT_RUNTIME'] === 'nodejs';

  // AIME_SDK_CLI_PATH is set by the Electron main process with the path
  // to the Agent SDK's native `claude` binary (electron/agent-sdk-binary.js).
  const sdkPath = process.env['AIME_SDK_CLI_PATH'];
  if (sdkPath) {
    (globalThis as Record<string, unknown>).__aimeClaudeSDKPath = sdkPath;
    if (isNodeRuntime) {
      const { logger } = await import('./lib/logger');
      logger.info({ event: 'aime.sdk_path_set', sdkPath }, 'Agent SDK binary path set from env');
    } else {
      console.log('[AIME] Agent SDK binary path set from env:', sdkPath);
    }
  }

  // Telemetry: start the periodic flush timer so queued analytics events
  // (conversation_completed, feature_adoption — both flush=false) actually
  // leave the process. Without this they sit in memory until the next
  // user_feedback or app-quit event, which most users never trigger.
  // Opt-in: with no ANALYTICS_API_URL there is no timer at all (the function
  // checks too; this just avoids loading the module for nothing).
  if (isNodeRuntime && process.env.ANALYTICS_API_URL) {
    const { startBufferFlushTimer } = await import('./lib/telemetry/event-buffer');
    startBufferFlushTimer();
  }

  // Widget scheduler (P6/C5): scheduled refreshes run HERE, in the server
  // process, which outlives the window — so a due widget refreshes and its run
  // is recorded even with every window closed. The renderer only syncs state.
  if (isNodeRuntime) {
    const { startWidgetScheduler } = await import('./lib/widgets/scheduler');
    startWidgetScheduler();
  }
}
