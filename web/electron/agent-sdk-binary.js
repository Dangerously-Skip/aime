/**
 * Where the packaged app's Agent SDK executable is.
 *
 * The SDK has shipped no cli.js since 0.2: the CLI is a native `claude` binary
 * in a per-platform sibling package, `@anthropic-ai/claude-agent-sdk-<platform>-<arch>`.
 * main-web.js kept looking for cli.js, never found it, warned on every launch
 * and passed nothing — which worked only because the SDK then tries the same
 * sibling itself. Returning the real file lets the doctor check name it, and a
 * missing one is logged at launch instead of surfacing as a failed first turn.
 *
 * `null` leaves resolution to the SDK, which also knows the musl variants.
 */
const path = require("path");

function agentSdkBinaryPath({ nodeModulesDir, platform, arch, exists }) {
  const binary = platform === "win32" ? "claude.exe" : "claude";
  const candidate = path.join(nodeModulesDir, "@anthropic-ai", `claude-agent-sdk-${platform}-${arch}`, binary);
  return exists(candidate) ? candidate : null;
}

module.exports = { agentSdkBinaryPath };
