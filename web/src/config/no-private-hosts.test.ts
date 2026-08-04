import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * No private or corporate hostname may ship in the source.
 *
 * Two shipped, both survivors of the rename from an internal product to an
 * open-source one, and neither was caught by reading the code:
 *
 *   - `search-proxy/route.ts` defaulted to an internal SearXNG host. Off that
 *     network it failed DNS and returned `{results: []}` — indistinguishable
 *     from "the web knows nothing about your query" — while the rest of the app
 *     reported search as unavailable. The two disagreed silently.
 *   - `telemetry/estimate-effort/route.ts` sent the caller's API key to an
 *     internal gateway whenever `apiKey.startsWith('sk-')`, which is true of
 *     EVERY Anthropic key. An ordinary user's credential was addressed to
 *     another company's private host. It failed DNS rather than leaking, so the
 *     only symptom was a crude-looking effort estimate.
 *
 * The second is why this test is about hostnames rather than about branding: a
 * leftover endpoint is a credential-handling bug wearing a cosmetic disguise.
 * `branding.test.ts` covers the product NAME; this covers where bytes are sent.
 */

const ROOTS = ['src', 'resources', 'scripts'].map((d) => path.resolve(__dirname, '../..', d));
const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml)$/i;

/**
 * Tests are excluded, and that is the whole design of this guard rather than a
 * convenience.
 *
 * A test is where you deliberately construct the forbidden thing to prove it is
 * handled. `mcp/url-guard.test.ts` lists `10.0.0.5`, `172.16.4.4` and
 * `192.168.1.10` in order to assert the SSRF guard REJECTS them; a scan that
 * counted those as violations would push someone to delete the security tests
 * to make the linter happy. `gw.internal` is likewise a fixture hostname in the
 * model-resolution tests, standing in for "some user's private gateway" — which
 * is a supported configuration, just not a shipped default.
 *
 * What ships to a user is non-test source. That is what this scans.
 */
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/i;

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return SCAN_EXT.test(e.name) && !IS_TEST.test(e.name) ? [full] : [];
  });
}

/** A comment line — prose about a banned pattern is not the pattern shipping. */
const isComment = (line: string) => /^\s*(\/\/|\/\*|\*|#)/.test(line);

/**
 * Hostname shapes that are private by construction.
 *
 * Deliberately about SHAPE, not a blocklist of one company's domains: the next
 * leftover will belong to somewhere else, and a list of past mistakes only ever
 * catches past mistakes. `.local`/`.lan` and RFC1918 literals are included for
 * the same reason — a hardcoded `192.168.x` default is the same defect.
 */
const PRIVATE_HOST_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'internal-subdomain', re: /\bhttps?:\/\/[a-z0-9.-]*\.internal\.[a-z0-9.-]+/i },
  { id: 'corp-subdomain', re: /\bhttps?:\/\/[a-z0-9.-]*\.(corp|intranet)\.[a-z0-9.-]+/i },
  { id: 'mdns-or-lan-tld', re: /\bhttps?:\/\/[a-z0-9-]+\.(local|lan|internal)\b/i },
  { id: 'rfc1918-literal', re: /\bhttps?:\/\/(10\.\d+|192\.168\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+)\.\d+/ },
];

describe('no private or corporate host ships in the source', () => {
  const files = ROOTS.flatMap(sourceFiles);

  it('finds files to scan — a guard over nothing passes vacuously', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(PRIVATE_HOST_PATTERNS)('has no $id', ({ re }) => {
    const hits: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf-8');
      text.split('\n').forEach((line, i) => {
        // Allow an explicitly-marked example; ban anything a request could reach.
        if (re.test(line) && !isComment(line) && !/example|placeholder|e\.g\./i.test(line)) {
          hits.push(`${path.relative(process.cwd(), f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(hits, `private host(s) in source:\n${hits.join('\n')}`).toEqual([]);
  });

  /**
   * The narrower half of the estimate-effort bug: not the hostname, but a
   * key-shape test used to decide where to send the key. `sk-` prefixes every
   * Anthropic key, so the branch fired for everyone. Any future routing
   * decision made by sniffing a credential deserves the same suspicion.
   */
  it('does not choose an API endpoint by sniffing the key prefix', () => {
    const hits: string[] = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (/\.startsWith\(\s*['"`]sk-['"`]\s*\)/.test(line) && !isComment(line)) {
            hits.push(`${path.relative(process.cwd(), f)}:${i + 1}`);
          }
        });
    }
    expect(
      hits,
      `'sk-' matches every Anthropic key, so this branch fires for ordinary ` +
        `users — it cannot identify a specific provider:\n${hits.join('\n')}`,
    ).toEqual([]);
  });
});
