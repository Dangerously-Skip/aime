import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveWithinTree } from '@/lib/path-containment';

/**
 * A read-only HTTP origin for previewing generated files.
 *
 * WHY THIS EXISTS. Previews were opened as `file://`, which gives the page a
 * NULL ORIGIN, and the modern web refuses to work there. Two failures we shipped
 * are the same bug:
 *
 *   - A generated deck embedded nine YouTube iframes. Every one rendered
 *     "Error 153 — video player configuration error", which is precisely
 *     YouTube's refusal to embed into a null origin. The iframes were correct.
 *   - A Three.js app's `<script type="module" src="/src/main.ts">` resolved to
 *     the FILESYSTEM ROOT and 404'd.
 *
 * ES modules, `fetch`, CORS, service workers and most embed providers all refuse
 * `file://`. Serving over `http://127.0.0.1` fixes the category, not an instance.
 *
 * WHY A SEPARATE SERVER, not a Next route. AIME's own API listens on
 * 127.0.0.1:<appPort> with no authentication, because "the caller is the
 * renderer" used to be true by construction. Preview content is UNTRUSTED — a
 * model wrote it, and it embeds third-party frames. Serving it from the app's
 * origin would make that content same-origin with `/api/files/read`. On its own
 * port it is a different origin, so the browser stops it, and `isCrossOriginRequest`
 * (which compares HOST, and host includes port) refuses it a second time.
 *
 * WHAT CONTAINS IT. Every one of these is load-bearing; see static-server.test.ts,
 * which drives a real server over a real socket rather than asserting on a mock:
 *
 *   1. Bound to 127.0.0.1 — never 0.0.0.0, so it is not on the LAN.
 *   2. An unguessable token as the first path segment. Not the main defence, but
 *      it means a page that merely guesses the port still has nothing.
 *   3. Host header must name a loopback authority on OUR port. This is the
 *      DNS-rebinding defence: rebinding is how a hostile page turns a
 *      cross-origin request into a same-origin one, and it cannot forge Host.
 *   4. Path containment via `resolveWithinTree` — the same helper the tool layer
 *      uses, and one of the few modules under mutation testing. Not a second
 *      implementation that can drift from the first.
 *   5. `realpath` after resolution, so a SYMLINK inside the root cannot point out
 *      of it. Containment checks the string; this checks what it actually opens.
 *   6. GET/HEAD only, no directory listing, and no `Access-Control-Allow-Origin`
 *      ever — so no other origin can read a response even if it reaches one.
 *
 * WHAT IT IS NOT. It serves bytes as they are on disk. An app that needs its
 * source TRANSFORMED — a Vite/Next project whose entry is `/src/main.ts` — needs
 * its own dev server; a static origin fixes that project's `file://` problems and
 * still cannot compile its TypeScript.
 */

/** Extension → content type. An allowlist: anything else is served as bytes. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

export interface PreviewServer {
  /** Origin including the token prefix, e.g. `http://127.0.0.1:51234/<token>`. */
  readonly baseUrl: string;
  readonly port: number;
  /** The interface actually bound. Asserted in tests: 0.0.0.0 would be the LAN. */
  readonly address: string;
  readonly token: string;
  readonly root: string;
  /** URL for a path relative to the root, or for an absolute path inside it. */
  urlFor(target: string): string | null;
  close(): Promise<void>;
}

export interface PreviewServerOptions {
  /** Only files at or below this directory are reachable. */
  root: string;
  /** Test seam. Production uses a 128-bit random token. */
  token?: string;
  /** Test seam; 0 asks the OS for an ephemeral port. */
  port?: number;
}

/**
 * Is this `Host` one of ours?
 *
 * Exported because it is the DNS-rebinding boundary and deserves its own tests.
 * A hostile page can point `evil.test` at 127.0.0.1 and issue same-origin
 * requests; what it cannot do is change the `Host` the browser sends, so
 * demanding a loopback name on our exact port refuses the rebound request.
 */
export function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  // Host is `authority`, so parse it as one rather than splitting on ':' —
  // that would mangle an IPv6 literal like `[::1]:1234`.
  let url: URL;
  try {
    url = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  if (url.port !== String(port)) return false;
  const h = url.hostname.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a request path to a real file inside `root`, or null.
 *
 * Exported so the traversal rules can be tested directly as well as over HTTP.
 * Returns null for every refusal rather than a reason: the caller answers 404 to
 * all of them, because distinguishing "outside the root" from "not found" tells
 * a caller whether a file exists.
 */
export async function resolveRequestPath(root: string, urlPath: string): Promise<string | null> {
  let decoded: string;
  try {
    // `%2e%2e%2f` is `../` that survives a naive string check. Decode BEFORE
    // containment, so containment sees what the filesystem will see.
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  // A NUL truncates the path at the syscall while passing a JS string check.
  if (decoded.includes('\0')) return null;

  const rel = decoded.replace(/^\/+/, '');
  const candidate = rel === '' ? 'index.html' : rel;

  const contained = resolveWithinTree(root, candidate);
  if (!contained.ok) return null;

  let target = contained.path;
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    // No listings, ever. A directory means its index or nothing.
    target = path.join(target, 'index.html');
    const nested = resolveWithinTree(root, target);
    if (!nested.ok) return null;
    try {
      if (!(await fs.stat(target)).isFile()) return null;
    } catch {
      return null;
    }
  } else if (!stat.isFile()) {
    // A fifo or device would otherwise hang the response forever.
    return null;
  }

  // Containment proved the STRING stays inside the root. A symlink is a file
  // whose string is innocent and whose target is not, so re-check what we are
  // about to open. `realpath` on the root too — on macOS /tmp is itself a link,
  // and comparing a resolved child against an unresolved base fails everything.
  let realTarget: string, realRoot: string;
  try {
    realTarget = await fs.realpath(target);
    realRoot = await fs.realpath(root);
  } catch {
    return null;
  }
  const escaped = resolveWithinTree(realRoot, realTarget);
  return escaped.ok ? realTarget : null;
}

export async function createPreviewServer(opts: PreviewServerOptions): Promise<PreviewServer> {
  const root = path.resolve(opts.root);
  const token = opts.token ?? randomBytes(16).toString('hex');

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const deny = (code: number, body = '') => {
      res.writeHead(code, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, 'Method Not Allowed');

    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : -1;
    if (!isAllowedHost(req.headers.host, boundPort)) return deny(403, 'Forbidden');

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${boundPort}`);
    const segments = url.pathname.split('/').filter(Boolean);
    // 404 rather than 403 on a bad token: a 403 confirms the server is a preview
    // server worth guessing at.
    if (segments[0] !== token) return deny(404, 'Not Found');

    const rest = '/' + segments.slice(1).join('/');
    const file = await resolveRequestPath(root, rest);
    if (!file) return deny(404, 'Not Found');

    let body: Buffer;
    try {
      body = await fs.readFile(file);
    } catch {
      return deny(404, 'Not Found');
    }

    res.writeHead(200, {
      'Content-Type': contentTypeFor(file),
      'Content-Length': String(body.byteLength),
      // No Access-Control-Allow-Origin, deliberately: another origin may reach
      // this server but must not be able to READ what it returns.
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      // Preview content is regenerated constantly; a stale frame reads as a bug
      // in the generator.
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // 127.0.0.1, never 0.0.0.0: this must not be reachable from the network.
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const address = typeof addr === 'object' && addr ? addr.address : '';
  const baseUrl = `http://127.0.0.1:${port}/${token}`;

  return {
    baseUrl,
    port,
    address,
    token,
    root,
    urlFor(target: string): string | null {
      const contained = resolveWithinTree(root, target);
      if (!contained.ok) return null;
      const rel = path.relative(root, contained.path);
      const encoded = rel.split(path.sep).map(encodeURIComponent).join('/');
      return `${baseUrl}/${encoded}`;
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
