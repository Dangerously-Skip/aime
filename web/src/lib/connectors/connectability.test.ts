import { describe, it, expect } from 'vitest';
import {
  classifyConnectability,
  classifyCatalog,
  effortRank,
  EFFORT_ORDER,
} from './connectability';
import { CONNECTOR_MAP, CONNECTOR_REGISTRY } from './registry';

/**
 * Runs against the real registry. The whole point is to describe what a user
 * actually faces on a clean install, so a fixture catalogue would defeat it.
 *
 * CLEAN is the default open-source install: no OAuth env vars set at all.
 */
const CLEAN: Record<string, string | undefined> = {};

const effortOf = (id: string, env = CLEAN) => classifyConnectability(CONNECTOR_MAP[id], env).effort;

describe('classifyConnectability — the one-click paths', () => {
  it('rates DCR connectors instant (nobody registers an app)', () => {
    // RFC 7591: the server issues a client on demand. This is the fastest path
    // available and the reason "be a good MCP client" beats a broker.
    for (const id of ['atlassian', 'figma', 'miro']) {
      expect(effortOf(id), id).toBe('instant');
    }
  });

  it('rates a published-client connector instant even without DCR', () => {
    // Slack has no DCR but ships a public marketplace client_id.
    expect(CONNECTOR_MAP.slack.auth.dcr).toBe('unsupported');
    expect(effortOf('slack')).toBe('instant');
  });

  it('rates the Microsoft FOCI public client instant on a clean install', () => {
    // m365-graph is the proof that a shipped public client_id needs no config.
    const c = classifyConnectability(CONNECTOR_MAP['m365-graph'], CLEAN);
    expect(c.effort).toBe('instant');
    expect(c.available).toBe(true);
    expect(c.detail).toMatch(/published app registration/);
  });

  it('rates ambient AWS credentials instant WHEN the environment actually has some', () => {
    expect(effortOf('aws', { AWS_PROFILE: 'default' })).toBe('instant');
    expect(effortOf('aws', { AWS_ACCESS_KEY_ID: 'AKIA…', AWS_SECRET_ACCESS_KEY: 's' })).toBe(
      'instant',
    );
  });
});

describe('classifyConnectability — aws_iam depends on credentials that may not exist', () => {
  it('REGRESSION: does not advertise AWS as one click on a machine with no credentials', () => {
    // The old verdict was an unconditional instant/available, so the chat prompt
    // listed AWS under "one click away" on a laptop that had never run
    // `aws configure`. Clicking then produced a credential error the prompt had
    // just promised would not happen.
    const c = classifyConnectability(CONNECTOR_MAP.aws, CLEAN);
    expect(c.effort).not.toBe('instant');
    expect(c.available).toBe(false);
    // and it says what to actually do about it
    expect(c.detail).toMatch(/aws sso login|aws configure/);
  });

  it('accepts every standard way ambient credentials arrive', () => {
    for (const env of [
      { AWS_PROFILE: 'dev' },
      { AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 'x' },
      { AWS_SESSION_TOKEN: 'tok', AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 'x' },
      { AWS_ROLE_ARN: 'arn:…', AWS_WEB_IDENTITY_TOKEN_FILE: '/var/run/tok' },
      { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/creds' },
      { AWS_SHARED_CREDENTIALS_FILE: '/home/u/.aws/credentials' },
      { AWS_CONFIG_FILE: '/home/u/.aws/config' },
    ]) {
      const c = classifyConnectability(CONNECTOR_MAP.aws, env);
      expect(c, JSON.stringify(env)).toMatchObject({ effort: 'instant', available: true });
    }
  });

  it('ignores an empty AWS variable — set-but-blank is not a credential', () => {
    expect(classifyConnectability(CONNECTOR_MAP.aws, { AWS_PROFILE: '' }).available).toBe(false);
  });

  it('leaks no credential values into the verdict', () => {
    const json = JSON.stringify(
      classifyConnectability(CONNECTOR_MAP.aws, {
        AWS_ACCESS_KEY_ID: 'AKIASECRET',
        AWS_SECRET_ACCESS_KEY: 'SECRETVALUE',
      }),
    );
    expect(json).not.toContain('AKIASECRET');
    expect(json).not.toContain('SECRETVALUE');
  });
});

describe('classifyConnectability — the slow paths, named honestly', () => {
  it('rates api_key connectors paste-token', () => {
    for (const id of ['github', 'buildkite', 'sumologic']) {
      expect(effortOf(id), id).toBe('paste-token');
    }
  });

  it('rates BYO-OAuth-app connectors needs-oauth-app, not instant', () => {
    // google-personal wants a GCP project, 3 API enablements and a consent
    // screen. It is connectable, but it must never outrank a one-click path.
    const c = classifyConnectability(CONNECTOR_MAP['google-personal'], CLEAN);
    expect(c.effort).toBe('needs-oauth-app');
    expect(c.available).toBe(true);
    expect(effortRank(c.effort)).toBeGreaterThan(effortRank('instant'));
  });

  it('marks google-workspace unavailable on a clean install instead of failing on click', () => {
    // This is the case that used to 500 from /api/connectors/oauth/config.
    const c = classifyConnectability(CONNECTOR_MAP['google-workspace'], CLEAN);
    expect(c.effort).toBe('needs-config');
    expect(c.available).toBe(false);
    // It must name the variable the code actually reads. Deriving it from the
    // connector id would say GOOGLE_WORKSPACE_CLIENT_ID and send the user on a
    // wild goose chase.
    expect(c.requiresEnv).toBe('GOOGLE_CLIENT_ID');
  });

  it('flips google-workspace to instant when GOOGLE_CLIENT_ID is set', () => {
    const c = classifyConnectability(CONNECTOR_MAP['google-workspace'], {
      GOOGLE_CLIENT_ID: 'real-id',
    });
    expect(c.effort).toBe('instant');
    expect(c.available).toBe(true);
  });

  it('marks the M365 MCP connectors unavailable until an app registration exists', () => {
    for (const id of ['outlook-mail', 'outlook-calendar', 'm365-copilot', 'onedrive-sharepoint']) {
      const c = classifyConnectability(CONNECTOR_MAP[id], CLEAN);
      expect(c.effort, id).toBe('needs-config');
      expect(c.available, id).toBe(false);
      expect(c.requiresEnv, id).toBe('MS365_CLIENT_ID');
      // and it says who can fix it
      expect(c.detail, id).toMatch(/IT admin/);
    }
  });

  it('flips those to instant once the app registration is configured', () => {
    const withEnv = { MS365_CLIENT_ID: 'some-guid' };
    for (const id of ['outlook-mail', 'onedrive-sharepoint']) {
      const c = classifyConnectability(CONNECTOR_MAP[id], withEnv);
      expect(c.effort, id).toBe('instant');
      expect(c.available, id).toBe(true);
    }
  });
});

describe('classifyCatalog', () => {
  it('puts every one-click service ahead of every slower one', () => {
    const ranked = classifyCatalog(CONNECTOR_REGISTRY, CLEAN);
    const ranks = ranked.map((c) => effortRank(c.effort));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('is alphabetical within a tier, so the list does not jitter', () => {
    const instant = classifyCatalog(CONNECTOR_REGISTRY, CLEAN)
      .filter((c) => c.effort === 'instant')
      .map((c) => c.name);
    expect(instant).toEqual([...instant].sort((a, b) => a.localeCompare(b)));
  });

  it('classifies the whole registry with no gaps', () => {
    const ranked = classifyCatalog(CONNECTOR_REGISTRY, CLEAN);
    expect(ranked).toHaveLength(CONNECTOR_REGISTRY.length);
    for (const c of ranked) {
      expect(EFFORT_ORDER, c.id).toContain(c.effort);
      expect(c.detail.length, c.id).toBeGreaterThan(0);
    }
  });

  it('a clean install still has several instant options — connecting is possible out of the box', () => {
    const instant = classifyCatalog(CONNECTOR_REGISTRY, CLEAN).filter((c) => c.available && c.effort === 'instant');
    expect(instant.length).toBeGreaterThanOrEqual(5);
  });

  it('leaks no secret values, only variable names', () => {
    const json = JSON.stringify(classifyCatalog(CONNECTOR_REGISTRY, { MS365_CLIENT_ID: 'SECRET-GUID' }));
    expect(json).not.toContain('SECRET-GUID');
  });

  it('preserves comingSoon so the UI can still gate it', () => {
    const zoom = classifyCatalog(CONNECTOR_REGISTRY, CLEAN).find((c) => c.id === 'zoom');
    expect(zoom?.comingSoon).toBe(true);
  });
});

/**
 * Every auth type the registry uses must be CLASSIFIED, not fall to `default`.
 *
 * `default` returns "Unsupported authentication type", and that string is not
 * cosmetic — `classifyCatalog` feeds `buildConnectorsPrompt`, so an
 * unclassified type puts its connector in the prompt's UNAVAILABLE bucket and
 * tells the model "never offer to connect these". `app-password` was added to
 * `types.ts` and `registry.ts` and not to the switch, so iCloud was declared
 * unavailable to the model in the same prompt that told it iCloud was
 * connected.
 *
 * Derived from the registry rather than listed, so the next auth type is
 * covered without anyone remembering this file exists.
 */
describe('no auth type falls through to "unsupported"', () => {
  const AUTH_TYPES = [...new Set(CONNECTOR_REGISTRY.map((c) => c.auth.type))];

  it('the registry uses more than one auth type, so this test can fail', () => {
    expect(AUTH_TYPES.length).toBeGreaterThan(1);
  });

  it.each(AUTH_TYPES)('%s is classified', (type) => {
    const connector = CONNECTOR_REGISTRY.find((c) => c.auth.type === type)!;
    const verdict = classifyConnectability(connector, {});
    expect(verdict.detail, `${type} fell through to the default branch`).not.toMatch(
      /unsupported authentication type/i,
    );
  });
});

/**
 * iCloud specifically, because it is the one that broke and because its
 * availability does not depend on anything in the build: the user creates the
 * app-specific password at appleid.apple.com. There is no env var that can be
 * missing, so a "needs-config" verdict would be wrong in every installation.
 */
describe('iCloud is offerable in every build', () => {
  const icloud = CONNECTOR_REGISTRY.find((c) => c.id === 'icloud');

  it('is in the registry', () => {
    expect(icloud, 'the iCloud connector was removed or renamed').toBeDefined();
  });

  it('is available with no environment configured at all', () => {
    const verdict = classifyConnectability(icloud!, {});
    expect(verdict.available).toBe(true);
    expect(verdict.effort).toBe('paste-token');
  });

  /*
   * Through `classifyCatalog`, because that is the function
   * `buildConnectorsPrompt` actually calls — the classification only matters
   * because it decides which half of the prompt the connector is named in.
   */
  it('is classified available by the catalogue the prompt is built from', () => {
    const classified = classifyCatalog(CONNECTOR_REGISTRY, {});
    const entry = classified.find((c) => c.id === 'icloud');
    expect(entry, 'iCloud vanished from the catalogue').toBeDefined();
    expect(entry!.available, 'iCloud would be listed as "never offer to connect"').toBe(true);
    expect(entry!.authType).toBe('app-password');
  });
});
