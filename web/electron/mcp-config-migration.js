/**
 * Launch-time repair of known-broken entries in the provisioned MCP config
 * (~/.claude/.aime-mcp.json, and the pre-rename .quarry-mcp.json).
 *
 * Lives here, not in main-web.js, so it can be tested — main-web.js runs only
 * inside Electron.
 *
 * WHY THE WRITE IS ATOMIC. This file holds every connector the user has set
 * up. The server writes it through lib/mcp/config-store.ts — locked, temp file
 * + rename — and this was the one writer left doing a plain `writeFileSync`,
 * which truncates first: a crash or a concurrent reader in that window sees an
 * empty or half-written file, i.e. every connector gone. It cannot import the
 * TypeScript store (plain CommonJS, and it runs before the server exists), so
 * it does the same thing by hand. No in-process lock is needed: it runs once,
 * before the server that owns the lock has started.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Replace `file` with `data` so a reader sees either the whole old file or the
 * whole new one. Keeps the existing file's mode (the store writes it 0600).
 */
function writeFileAtomicSync(file, data) {
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    // New file: owner-only, like the store.
  }
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = fs.openSync(tmp, "wx", mode);
    try {
      fs.writeFileSync(fd, data, "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(tmp, mode); // `open` masks the mode with the umask
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * Patch one config file. Returns true when it was rewritten. Never throws: a
 * failed repair must not stop the app from launching.
 */
function migrateMcpConfigFile(configPath, log = console) {
  try {
    if (!fs.existsSync(configPath)) return false;

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!config || !config.mcpServers) return false;

    let changed = false;
    const servers = config.mcpServers;

    // Fix Miro — the actual MCP JSON-RPC endpoint is at / not /mcp
    if (servers["nib-mcp-miro"] && servers["nib-mcp-miro"].url === "https://mcp.miro.com/mcp") {
      servers["nib-mcp-miro"].url = "https://mcp.miro.com/";
      changed = true;
      log.log("[AIME] Migrated Miro MCP URL (/mcp -> /)");
    }

    // Fix AWS — switch from non-existent npm package to AWS Labs' Python MCP via uvx
    const aws = servers["nib-connector-aws"];
    if (aws && Array.isArray(aws.args) && aws.args.some((a) => typeof a === "string" && a.includes("@aws/mcp-server-aws"))) {
      aws.command = "uvx";
      aws.args = ["awslabs.core-mcp-server@latest"];
      changed = true;
      log.log("[AIME] Migrated AWS MCP to awslabs.core-mcp-server via uvx");
    }

    if (changed) writeFileAtomicSync(configPath, JSON.stringify(config, null, 2));
    return changed;
  } catch (err) {
    log.warn("[AIME] MCP config migration failed:", err && err.message);
    return false;
  }
}

module.exports = { migrateMcpConfigFile, writeFileAtomicSync };
