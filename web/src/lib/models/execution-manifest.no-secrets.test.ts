import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildManifest, parseManifest } from './execution-manifest';

/**
 * THE MANIFEST IS PLAIN JSON ON DISK. NO SECRET MAY REACH IT.
 *
 * The credential store next to it is encrypted; this one is not, deliberately —
 * a model selection is configuration, not a key, and encrypting configuration
 * buys nothing while making it unreadable when something goes wrong.
 *
 * That is only safe while the file genuinely holds no secrets, and the route
 * that writes it is unauthenticated on loopback. So the rule is enforced rather
 * than trusted, at both ends: `buildManifest` on the way in, `parseManifest` on
 * the way out, and this suite over both.
 */

/** Shapes a caller might plausibly hand us, all of which must be scrubbed. */
const HOSTILE = [
  { providerId: 'p', apiKey: 'sk-ant-secret' },
  { providerId: 'p', api_key: 'sk-openai-secret' },
  { providerId: 'p', ANTHROPIC_API_KEY: 'sk-env-secret' },
  { providerId: 'p', token: 'ghp_tokensecret' },
  { providerId: 'p', accessToken: 'bearer-secret' },
  { providerId: 'p', password: 'hunter2secret' },
  { providerId: 'p', clientSecret: 'oauth-secret' },
  { providerId: 'p', credentials: { apiKey: 'nested-secret' } },
  { providerId: 'p', settings: { password: 'deep-secret' } },
];

describe('nothing secret survives a build', () => {
  it.each(HOSTILE)('scrubs %j', (config) => {
    const m = buildManifest(
      [{ capability: 'chat', model: 'sonnet', providerConfig: config }],
      '2026-08-22T00:00:00.000Z',
    );
    expect(JSON.stringify(m)).not.toMatch(/secret/i);
  });

  it('keeps what the server actually needs', () => {
    // Scrubbing must not be so eager that the config stops being executable.
    const m = buildManifest(
      [{
        capability: 'chat', model: 'x',
        providerConfig: { providerId: 'openrouter-1', baseUrl: 'https://openrouter.ai/api/v1', agentMode: 'api-key' },
      }],
      'now',
    );
    expect(m.routes.chat.providerConfig).toEqual({
      providerId: 'openrouter-1',
      baseUrl: 'https://openrouter.ai/api/v1',
      agentMode: 'api-key',
    });
  });
});

describe('nothing secret survives a read either', () => {
  it.each(HOSTILE)('scrubs %j on the way out', (config) => {
    /*
     * The file could have been written by an older build, or edited by hand.
     * Scrubbing only on write would leave a secret readable for ever once one
     * had got in.
     */
    const parsed = parseManifest({
      version: 1,
      updatedAt: 'now',
      routes: { chat: { model: 'sonnet', providerConfig: config } },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/secret/i);
  });
});

describe('the module itself', () => {
  it('names the fields it refuses, so the list is reviewable', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/models/execution-manifest.ts'),
      'utf8',
    );
    for (const field of ['apiKey', 'token', 'secret', 'password', 'credential']) {
      expect(src).toContain(field);
    }
  });

  it('scrubs on BOTH paths, not just one', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/models/execution-manifest.ts'),
      'utf8',
    );
    const build = src.slice(src.indexOf('export function buildManifest'));
    const parse = src.slice(src.indexOf('export function parseManifest'), src.indexOf('export function buildManifest'));
    expect(build).toContain('stripSecrets');
    expect(parse).toContain('stripSecrets');
  });
});
