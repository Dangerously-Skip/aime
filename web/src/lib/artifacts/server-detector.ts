/**
 * Detects dev server URLs from Bash tool output.
 * Returns the first matched URL or null.
 */

const URL_PATTERNS = [
  // Explicit URLs: http://localhost:3000, http://127.0.0.1:8080, http://0.0.0.0:5173
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/gi,
  // Framework messages: "Local: http://localhost:3000"
  /Local:\s*(https?:\/\/localhost:\d+)/gi,
  // "ready on port 3001", "listening on port 8080"
  /(?:ready|listening|started|running)\s+(?:on|at)\s+(?:port\s+)?(\d{4,5})/gi,
  // "Server running at http://..."
  /Server\s+running\s+at\s+(https?:\/\/[^\s]+)/gi,
];

export interface DetectedServer {
  url: string;
  raw: string; // the matched text for display
}

export function detectServerUrl(output: string): DetectedServer | null {
  if (!output) return null;

  for (const pattern of URL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(output);
    if (match) {
      // If the match has a capture group, prefer it; otherwise use full match
      const captured = match[1] || match[0];

      // If it's a port-only match, construct the URL
      if (/^\d+$/.test(captured)) {
        return {
          url: `http://localhost:${captured}`,
          raw: match[0],
        };
      }

      // Normalize 0.0.0.0 → localhost for Electron webview compatibility
      const url = captured.replace("0.0.0.0", "localhost");
      return { url, raw: match[0] };
    }
  }

  return null;
}

/**
 * Quick check if output likely contains a server URL (cheaper than full detect).
 */
export function mightContainServerUrl(output: string): boolean {
  return /localhost:\d+|127\.0\.0\.1:\d+|0\.0\.0\.0:\d+|ready on port|listening on port|Server running/i.test(
    output
  );
}

/**
 * Web asset extensions that often accompany HTML files in a web project.
 */
const WEB_ASSET_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

export function isWebAsset(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return WEB_ASSET_EXTENSIONS.has(ext);
}

/**
 * Walks from a file's directory up to rootDir looking for an HTML entry point.
 * Returns the absolute path to the first found HTML file, or null.
 * Requires Electron's fileExists IPC.
 */
const HTML_ENTRY_NAMES = ["index.html", "index.htm", "default.html"];

export async function findHtmlEntryPoint(
  filePath: string,
  rootDir: string
): Promise<string | null> {
  const fileExists = window.electronAPI?.fileExists;
  if (!fileExists) return null;

  // Normalize: strip trailing slashes
  const root = rootDir.replace(/\/+$/, "");
  // Start from the directory containing filePath
  let dir = filePath.substring(0, filePath.lastIndexOf("/"));

  while (dir.length >= root.length) {
    for (const name of HTML_ENTRY_NAMES) {
      const candidate = `${dir}/${name}`;
      try {
        if (await fileExists(candidate)) return candidate;
      } catch {
        // fileExists IPC failed — skip
      }
    }
    // Move up one directory
    const parent = dir.substring(0, dir.lastIndexOf("/"));
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return null;
}
