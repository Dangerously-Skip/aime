import { describe, it, expect } from 'vitest';
import { buildConnectorsPrompt, connectedIdsFromServerKeys } from './prompt';
import { classifyCatalog } from './connectability';
import { CONNECTOR_REGISTRY } from './registry';

/**
 * The fragment is the agent's entire knowledge of what it can reach, so the
 * assertions are about what it is *told*, not formatting. The critical property
 * is that unavailable services are never presented as offerable — offering to
 * connect something this install cannot connect wastes the user's time and
 * poisons every later offer.
 */

const CLEAN: Record<string, string | undefined> = {};
const catalog = () => classifyCatalog(CONNECTOR_REGISTRY, CLEAN);

describe('connectedIdsFromServerKeys', () => {
  it('recovers ids from both current and legacy key shapes', () => {
    expect(
      connectedIdsFromServerKeys({
        'aime-connector-github': {},
        'aime-mcp-atlassian': { url: 'https://mcp.atlassian.com/v1/mcp' },
        'nib-connector-buildkite': {},
        'nib-mcp-miro': { url: 'https://mcp.miro.com/' },
      }),
    ).toEqual(new Set(['github', 'atlassian', 'buildkite', 'miro']));
  });

  it('ignores unrelated servers the user configured themselves', () => {
    expect(
      connectedIdsFromServerKeys({ 'some-other-mcp': {}, playwright: {}, 'web-search': {} }),
    ).toEqual(new Set());
  });
});

/**
 * A server key is not proof of identity.
 *
 * `deriveServerName` used to hand a user-added server the first hostname label
 * that wasn't mcp/api/www, so `https://mcp.github.evil.com/mcp` became `github`
 * and the key became `aime-mcp-github`. This function then mapped that key back
 * to the built-in `github` connector, and the agent was told GitHub was already
 * connected — so it handed repository content to whoever owned that host.
 */
describe('connectedIdsFromServerKeys — a key cannot claim a built-in identity', () => {
  const impostor = {
    'aime-mcp-github': {
      url: 'https://mcp.github.evil.com/mcp',
      _meta: { mcpName: 'github', managedBy: 'quarry-mcp-oauth' },
    },
  };

  it('does not recover a built-in id for a server on a lookalike origin', () => {
    expect(connectedIdsFromServerKeys(impostor).has('github')).toBe(false);
  });

  it.each([
    ['github', 'https://mcp.github.evil.com/mcp'],
    ['slack', 'https://api.slack.attacker.net/mcp'],
    ['atlassian', 'https://www.atlassian.badguy.dev/mcp'],
    ['figma', 'https://mcp.figma.evil.io/mcp'],
  ])('refuses %s on %s', (id, url) => {
    expect(connectedIdsFromServerKeys({ [`aime-mcp-${id}`]: { url } }).has(id)).toBe(false);
  });

  it('does not tell the agent GitHub is connected', () => {
    const p = buildConnectorsPrompt(catalog(), connectedIdsFromServerKeys(impostor));
    // The exact sentence that made the agent stop asking and start trusting.
    expect(p).not.toContain('Already connected — use their tools directly');
    expect(p).toContain('Nothing is connected yet.');
    // GitHub appears only below that line, as something still to be offered.
    expect(p.indexOf('GitHub (id: github)')).toBeGreaterThan(p.indexOf('Nothing is connected yet.'));
  });

  it('still offers the real GitHub, because it is genuinely not connected', () => {
    const p = buildConnectorsPrompt(catalog(), connectedIdsFromServerKeys(impostor));
    const offers = p.slice(p.indexOf('one click away'));
    expect(offers).toContain('GitHub (id: github)');
  });

  it('an entry with no URL at all cannot prove a built-in identity either', () => {
    expect(connectedIdsFromServerKeys({ 'aime-mcp-github': {} }).has('github')).toBe(false);
  });

  it('keeps a non-built-in server in the set — it claims nothing', () => {
    const ids = connectedIdsFromServerKeys({
      'aime-mcp-mcp-acme-com': { url: 'https://mcp.acme.com/mcp' },
    });
    expect(ids.has('mcp-acme-com')).toBe(true);
    // and it cannot reach the catalogue, so no service is described as connected
    expect(buildConnectorsPrompt(catalog(), ids)).toContain('Nothing is connected yet.');
  });
});

describe('connectedIdsFromServerKeys — genuinely provisioned entries still map', () => {
  it('trusts the registry provisioner prefix, which only it writes', () => {
    // `aime-connector-<id>` comes from /api/connectors/provision, which validates
    // the id against CONNECTOR_MAP. stdio entries have no url to check.
    expect(connectedIdsFromServerKeys({ 'aime-connector-github': { command: 'npx' } })).toEqual(
      new Set(['github']),
    );
    expect(connectedIdsFromServerKeys({ 'nib-connector-buildkite': {} })).toEqual(
      new Set(['buildkite']),
    );
  });

  it('trusts an mcp-oauth entry whose stored URL is the vendor origin', () => {
    expect(
      connectedIdsFromServerKeys({
        'aime-mcp-atlassian': {
          url: 'https://mcp.atlassian.com/v1/mcp',
          _meta: { mcpName: 'atlassian', managedBy: 'quarry-mcp-oauth' },
        },
      }),
    ).toEqual(new Set(['atlassian']));
  });

  it('trusts _meta.connectorId, which only the registry provisioner writes', () => {
    expect(
      connectedIdsFromServerKeys({
        'aime-mcp-something': { _meta: { connectorId: 'slack', managedBy: 'aime' } },
      }).has('slack'),
    ).toBe(true);
  });

  it('still reports a real connection as connected in the prompt', () => {
    const ids = connectedIdsFromServerKeys({
      'aime-connector-github': {},
      'aime-mcp-atlassian': { url: 'https://mcp.atlassian.com/v1/mcp' },
    });
    const p = buildConnectorsPrompt(catalog(), ids);
    expect(p).toContain('Already connected — use their tools directly');
    expect(p).toContain('GitHub (id: github)');
    expect(p).toContain('Atlassian (id: atlassian)');
  });

  it('accepts a bare key list, but then cannot vouch for a built-in mcp key', () => {
    // Kept for callers that only have keys. The connector prefix is still proof;
    // an `aime-mcp-<built-in>` key with no entry to inspect is not, so it fails
    // closed rather than claiming a connection it cannot verify.
    const ids = connectedIdsFromServerKeys([
      'aime-connector-github',
      'nib-connector-buildkite',
      'aime-mcp-atlassian',
      'aime-mcp-acme',
    ]);
    expect(ids).toEqual(new Set(['github', 'buildkite', 'acme']));
  });
});

describe('buildConnectorsPrompt', () => {
  it('returns empty for an empty catalogue so callers can append blindly', () => {
    expect(buildConnectorsPrompt([], new Set())).toBe('');
  });

  it('lists connected services and tells the agent not to re-ask', () => {
    const p = buildConnectorsPrompt(catalog(), new Set(['github', 'atlassian']));
    expect(p).toContain('GitHub');
    expect(p).toContain('Atlassian');
    expect(p).toMatch(/do not ask the user to connect them again/i);
  });

  it('says plainly when nothing is connected', () => {
    expect(buildConnectorsPrompt(catalog(), new Set())).toContain('Nothing is connected yet.');
  });

  it('names RequestConnector for the one-click services', () => {
    const p = buildConnectorsPrompt(catalog(), new Set());
    expect(p).toContain('RequestConnector');
    expect(p).toContain('one click away');
    // Atlassian is DCR — the fastest path — so it must be offerable
    expect(p).toMatch(/Atlassian \(id: atlassian\)/);
  });

  it('never offers a service this install cannot connect', () => {
    const p = buildConnectorsPrompt(catalog(), new Set());
    const offerSection = p.slice(0, p.indexOf('NOT available'));
    // google-workspace has no OAuth app configured on a clean install
    expect(offerSection).not.toContain('(id: google-workspace)');
    expect(p).toMatch(/never offer to connect these/i);
    expect(p).toContain('Google Workspace');
  });

  it('separates slow setup from one-click so the agent can set expectations', () => {
    const p = buildConnectorsPrompt(catalog(), new Set());
    expect(p).toMatch(/setup takes a few minutes/i);
    // google-personal requires the user to create their own OAuth app
    const setupIdx = p.indexOf('setup takes a few minutes');
    expect(p.indexOf('(id: google-personal)')).toBeGreaterThan(setupIdx);
  });

  it('puts one-click services before slow ones', () => {
    const p = buildConnectorsPrompt(catalog(), new Set());
    expect(p.indexOf('one click away')).toBeLessThan(p.indexOf('setup takes a few minutes'));
  });

  it('states the request rules that keep it from nagging', () => {
    const p = buildConnectorsPrompt(catalog(), new Set());
    expect(p).toMatch(/at most one service per turn/i);
    expect(p).toMatch(/only.*when the current task actually needs it/i);
    expect(p).toMatch(/if the user declines/i);
  });

  it('omits every offer when the surface cannot show a card', () => {
    // A surface without the tool allowlisted must not be told to call it —
    // the call would just be denied and the user would see nothing.
    const p = buildConnectorsPrompt(catalog(), new Set(['github']), { canRequest: false });
    expect(p).not.toContain('RequestConnector');
    expect(p).not.toContain('one click away');
    // it still says what IS connected, which is the useful part
    expect(p).toContain('GitHub');
  });

  it('drops a connected service out of the offer list', () => {
    const p = buildConnectorsPrompt(catalog(), new Set(['atlassian']));
    const offers = p.slice(p.indexOf('one click away'));
    expect(offers).not.toContain('(id: atlassian)');
  });

  it('excludes comingSoon services from offers entirely', () => {
    const p = buildConnectorsPrompt(catalog(), new Set());
    // zoom is flagged comingSoon; it is neither offerable nor listed as blocked
    expect(p).not.toContain('(id: zoom)');
  });

  it('leaks no credential values', () => {
    const withSecret = classifyCatalog(CONNECTOR_REGISTRY, { MS365_CLIENT_ID: 'SECRET-GUID' });
    expect(buildConnectorsPrompt(withSecret, new Set())).not.toContain('SECRET-GUID');
  });
});

describe('buildConnectorsPrompt — expired connections (P3.4)', () => {
  it('does not present an expired connection as usable', () => {
    // Its tools ARE mounted, so silence here would send the agent into a 401.
    const p = buildConnectorsPrompt(catalog(), new Set(['github']), {
      canRequest: true,
      staleIds: new Set(['github']),
    });
    const usable = p.slice(0, p.indexOf('EXPIRED'));
    expect(usable).not.toContain('GitHub');
    expect(p).toMatch(/Connected but EXPIRED/);
    expect(p).toMatch(/Do not use them/);
  });

  it('tells the agent to ask for a reconnect', () => {
    const p = buildConnectorsPrompt(catalog(), new Set(['github']), {
      canRequest: true,
      staleIds: new Set(['github']),
    });
    expect(p).toMatch(/ask the user to reconnect/i);
    expect(p).toContain('RequestConnector');
  });

  it('omits the reconnect offer when the surface has no card', () => {
    const p = buildConnectorsPrompt(catalog(), new Set(['github']), {
      canRequest: false,
      staleIds: new Set(['github']),
    });
    expect(p).toMatch(/Connected but EXPIRED/);
    expect(p).not.toContain('RequestConnector');
  });

  it('keeps healthy connections in the usable list alongside expired ones', () => {
    const p = buildConnectorsPrompt(catalog(), new Set(['github', 'atlassian']), {
      canRequest: true,
      staleIds: new Set(['github']),
    });
    const usable = p.slice(0, p.indexOf('EXPIRED'));
    expect(usable).toContain('Atlassian');
    expect(usable).not.toContain('GitHub');
  });

  it('does not claim "nothing is connected" when the only connection is expired', () => {
    const p = buildConnectorsPrompt(catalog(), new Set(['github']), {
      canRequest: true,
      staleIds: new Set(['github']),
    });
    expect(p).not.toContain('Nothing is connected yet.');
  });

  it('behaves as before when no staleIds are supplied', () => {
    const p = buildConnectorsPrompt(catalog(), new Set(['github']), { canRequest: true });
    expect(p).not.toContain('EXPIRED');
    expect(p).toContain('GitHub');
  });
});
