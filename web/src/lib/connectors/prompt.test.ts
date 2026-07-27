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
      connectedIdsFromServerKeys([
        'aime-connector-github',
        'aime-mcp-atlassian',
        'nib-connector-buildkite',
        'nib-mcp-miro',
      ]),
    ).toEqual(new Set(['github', 'atlassian', 'buildkite', 'miro']));
  });

  it('ignores unrelated servers the user configured themselves', () => {
    expect(connectedIdsFromServerKeys(['some-other-mcp', 'playwright', 'web-search'])).toEqual(
      new Set(),
    );
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
