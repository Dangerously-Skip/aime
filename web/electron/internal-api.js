/**
 * Requests from the Electron main process to the app's own Next server.
 *
 * The local API refuses anything without a credential (src/proxy.ts), and these
 * calls had none: the bundled-skill install and the lifecycle telemetry both got
 * a 401 on every launch. Nobody saw it, because the bundled-skill install logged
 * the status as if it were a success and the lifecycle call never looked at the
 * response at all.
 *
 * Main is not a browser and has no cookie, so it authenticates the way any
 * non-browser client does: `Authorization: Bearer <AIME_API_TOKEN>` — the token
 * main minted and handed the server in the first place. See
 * src/lib/auth/local-token.ts (`decide`, step 4).
 */
const http = require("http");

/**
 * POST `body` (object, or undefined for an empty body) to `path` on the local
 * server. Never rejects: resolves `{ ok, status, error? }` so callers log rather
 * than crash the main process. `timeoutMs` bounds the whole exchange.
 */
function postInternal({ port, path, token, body, timeoutMs = 10_000, log = console.warn, label = path }) {
  return new Promise((resolve) => {
    let req = null;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.ok) {
        log(
          `[AIME] ${label} failed: ` +
            (result.status ? `HTTP ${result.status}` : result.error || "no response"),
        );
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (req) req.destroy();
      finish({ ok: false, status: 0, error: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    if (!token) {
      finish({ ok: false, status: 0, error: "no API token — the server would refuse this" });
      return;
    }

    const payload = body === undefined ? "" : JSON.stringify(body);
    try {
      req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            Authorization: `Bearer ${token}`,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => {
            const status = res.statusCode || 0;
            finish({ ok: status >= 200 && status < 300, status });
          });
        },
      );
      req.on("error", (err) => finish({ ok: false, status: 0, error: err.message }));
      req.end(payload);
    } catch (err) {
      finish({ ok: false, status: 0, error: err.message });
    }
  });
}

module.exports = { postInternal };
