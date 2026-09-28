import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import nextConfig from './next.config';

const require_ = createRequire(import.meta.url);

/**
 * Config that only fails at runtime, in the packaged app, with a large file.
 */

describe('request body limit behind the proxy', () => {
  // Next's own parser for the value, so '200mb' vs 200 * 1024 * 1024 vs a typo
  // is judged exactly as the server will judge it.
  const bytes = require_('next/dist/compiled/bytes') as { parse: (v: string | number) => number | null };

  it('is set, under the key the installed Next actually reads', () => {
    // A renamed option is silently ignored, which is how a limit "set" in
    // config can still truncate at the default.
    const shared = readFileSync(require_.resolve('next/dist/server/config-shared.js'), 'utf-8');
    expect(shared).toContain('proxyClientMaxBodySize');
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeDefined();
  });

  it('is at least 200 MB — the 10 MB default truncated attachments', () => {
    const raw = nextConfig.experimental!.proxyClientMaxBodySize!;
    const parsed = typeof raw === 'number' ? raw : bytes.parse(raw);
    expect(parsed).toBeGreaterThanOrEqual(200 * 1024 * 1024);
  });

  it('does not also set the deprecated alias (Next refuses to start with both)', () => {
    expect((nextConfig.experimental as Record<string, unknown>).middlewareClientMaxBodySize).toBeUndefined();
  });
});

describe('security headers', () => {
  async function headers() {
    const rules = (await nextConfig.headers?.()) ?? [];
    // Every rule here is a catch-all; assert that, then flatten.
    for (const r of rules) expect(r.source).toBe('/:path*');
    return Object.fromEntries(rules.flatMap((r) => r.headers).map((h) => [h.key.toLowerCase(), h.value]));
  }

  it('forbids framing by any other origin (clickjacking from another local tab)', async () => {
    const h = await headers();
    expect(h['content-security-policy']).toMatch(/frame-ancestors 'self'/);
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
  });

  /**
   * Why there is no script-src / connect-src / default-src here — so nobody
   * "finishes" this CSP without meeting these:
   *
   *  - The artifact, HTML-file and design previews are `<iframe srcdoc>`, and a
   *    srcdoc document INHERITS its parent's CSP. A script-src on the app would
   *    silently break every model-written page that loads a library from a CDN.
   *  - Next's App Router injects inline bootstrap scripts, and layout.tsx has an
   *    inline pre-hydration theme script. Without per-request nonces (dynamic
   *    rendering of every page, set in the proxy), script-src must include
   *    'unsafe-inline' — at which point it no longer stops injected script.
   *  - Local Whisper (voice input) loads the ONNX runtime from cdn.jsdelivr.net
   *    and model weights from huggingface.co, from the renderer.
   *
   * So a policy that restricts script would break real features and stop
   * nothing. These assertions keep the shipped policy to directives that are
   * NOT inherited in a harmful way.
   */
  it('sets no directive that srcdoc previews would inherit and break under', async () => {
    const h = await headers();
    const csp = h['content-security-policy'];
    for (const directive of ['default-src', 'script-src', 'connect-src', 'style-src', 'img-src', 'object-src', 'base-uri']) {
      expect(csp).not.toContain(directive);
    }
  });
});
