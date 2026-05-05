/**
 * Next.js instrumentation hook — runs once on server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // QUARRY_SDK_CLI_PATH is set by the Electron main process with the path
  // to the CLI binary (copied outside the app bundle for execution).
  const sdkPath = process.env['QUARRY_SDK_CLI_PATH'];
  if (sdkPath) {
    (globalThis as Record<string, unknown>).__quarryClaudeSDKPath = sdkPath;
    console.log('[Quarry] Claude SDK cli.js path set from env:', sdkPath);
  }

  // Telemetry: start the periodic flush timer so queued analytics events
  // (conversation_completed, feature_adoption — both flush=false) actually
  // leave the process. Without this they sit in memory until the next
  // user_feedback or app-quit event, which most users never trigger.
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { startBufferFlushTimer } = await import('./lib/telemetry/event-buffer');
    startBufferFlushTimer();
  }
}
