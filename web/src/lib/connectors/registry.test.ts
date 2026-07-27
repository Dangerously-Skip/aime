import { describe, it, expect } from 'vitest';
import { CONNECTOR_REGISTRY, CONNECTOR_MAP } from './registry';
import { buildTrustedMcpEntry } from './provision-guard';

/**
 * `registry.ts` is the live registry — and for a long time it was not the only
 * candidate. A `registry/` DIRECTORY sat beside it with its own `index.ts`
 * exporting the same two symbols, thirteen connectors to this file's sixteen, and
 * a different `tokenInjection` for `aws`. Node and TypeScript both resolve
 * `./registry` to the FILE, so the directory was dead — but nothing said so, and
 * the divergence read as a live disagreement about which env var AWS uses.
 *
 * The directory is gone. These tests pin the facts that made it identifiable, so
 * a future copy cannot quietly take over: the ids the app actually ships, and the
 * env var the aws entry declares.
 */

describe('the live registry is registry.ts', () => {
  it('exposes the sixteen connectors the app ships, not a thirteen-entry subset', () => {
    // The dead directory's ids were jira/confluence/outlook/sharepoint/
    // google-drive — names this registry does not use. If any of them ever
    // resolves again, `./registry` has stopped meaning this file.
    expect(CONNECTOR_REGISTRY).toHaveLength(16);
    expect(Object.keys(CONNECTOR_MAP)).toEqual(
      expect.arrayContaining(['atlassian', 'google-workspace', 'm365-graph', 'onedrive-sharepoint']),
    );
    for (const gone of ['jira', 'confluence', 'outlook', 'sharepoint', 'google-drive']) {
      expect(CONNECTOR_MAP[gone], gone).toBeUndefined();
    }
  });

  it('keys CONNECTOR_MAP by id with no duplicates', () => {
    const ids = CONNECTOR_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CONNECTOR_REGISTRY) expect(CONNECTOR_MAP[c.id]).toBe(c);
  });
});

describe('aws declares an env var that a bypass could not weaponise', () => {
  it('names AWS_PROFILE, never a static-credential variable', () => {
    // The registry said AWS_ACCESS_KEY_ID while provision-guard's comment and both
    // aws tests in the provision route said AWS_PROFILE. Env static keys are the
    // HIGHEST-precedence entry in the AWS credential chain, so a value written
    // there shadows the working profile and breaks every AWS tool call rather than
    // just naming a profile that does not exist.
    expect(CONNECTOR_MAP.aws.mcp.tokenInjection).toEqual({
      method: 'env',
      envVar: 'AWS_PROFILE',
    });
  });

  it('no connector injects into a static AWS credential slot', () => {
    const forbidden = new Set([
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'AWS_SHARED_CREDENTIALS_FILE',
      'AWS_CONFIG_FILE',
    ]);
    for (const c of CONNECTOR_REGISTRY) {
      const injection = c.mcp.tokenInjection;
      if (injection.method !== 'env') continue;
      expect(forbidden.has(injection.envVar), `${c.id} → ${injection.envVar}`).toBe(false);
    }
  });

  it('defence in depth: even a non-empty token cannot reach the top of the chain', () => {
    // The provision route blanks the token for aws_iam (CREDENTIAL_FREE_AUTH), so
    // in production nothing is injected at all — asserted by the route's own
    // tests. This pins what happens if that gate is ever bypassed: whatever lands,
    // it lands in AWS_PROFILE, which the shared-config provider ignores entirely
    // when env or container credentials are present.
    const entry = buildTrustedMcpEntry(CONNECTOR_MAP.aws, 'aws-iam', '/app');
    expect(entry.env).toEqual({ AWS_PROFILE: 'aws-iam' });
    expect(Object.keys(entry.env ?? {})).not.toContain('AWS_ACCESS_KEY_ID');
  });

  it('and injects nothing at all for the empty token the route actually passes', () => {
    const entry = buildTrustedMcpEntry(CONNECTOR_MAP.aws, '', '/app');
    expect(entry.env).toBeUndefined();
    expect(entry).toMatchObject({ transport: 'stdio', command: 'uvx' });
  });
});
