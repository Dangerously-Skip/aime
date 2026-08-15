/**
 * Turn a local path into a previewable URL.
 *
 * Callers used to build `file://${path}` inline. That is the bug: a `file://`
 * page has a NULL ORIGIN, and YouTube embeds (Error 153), ES modules, `fetch`,
 * CORS and service workers all refuse it. `/api/preview` hands back an
 * `http://127.0.0.1` origin instead — see `lib/preview/static-server.ts`.
 *
 * Falls back to `file://` when the endpoint cannot be reached, because a preview
 * that mostly works beats no preview at all — but the fallback is the OLD broken
 * behaviour, so it is reported rather than silently substituted.
 */
export interface PreviewUrl {
  url: string;
  /** False when this is the `file://` fallback, i.e. embeds and modules will fail. */
  served: boolean;
}

export async function previewUrlFor(filePath: string): Promise<PreviewUrl> {
  const clean = filePath.replace(/^file:\/\//, '');
  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: clean }),
    });
    if (res.ok) {
      const data = (await res.json()) as { url?: unknown };
      if (typeof data.url === 'string' && data.url) return { url: data.url, served: true };
    }
  } catch {
    // fall through
  }
  return { url: `file://${clean}`, served: false };
}

/** The local path behind a preview URL, whichever kind it is. */
export function pathFromPreviewUrl(url: string, root?: string): string | null {
  if (url.startsWith('file://')) return decodeURIComponent(url.slice('file://'.length));
  if (!root) return null;
  try {
    const parsed = new URL(url);
    // `/<token>/<relative path>` — drop the token.
    const segments = parsed.pathname.split('/').filter(Boolean).slice(1);
    return segments.length ? `${root}/${segments.map(decodeURIComponent).join('/')}` : root;
  } catch {
    return null;
  }
}
