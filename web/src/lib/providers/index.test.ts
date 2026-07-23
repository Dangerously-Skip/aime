import { describe, it, expect, vi } from 'vitest';
import { getAvailableProviders, getProvider } from './index';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  tool: vi.fn(),
  createSdkMcpServer: vi.fn(),
}));

describe('provider registry', () => {
  // Guard for the open-source cleanup: opencode and the nib gateway provider
  // were removed (DR-8). The multi-provider model registry is a roadmap
  // pillar — new engines should arrive through that design, not ad hoc here.
  it('exposes exactly the claude provider', () => {
    expect(getAvailableProviders()).toEqual(['claude']);
  });

  it('resolves claude case-insensitively and caches instances', () => {
    const a = getProvider('Claude');
    const b = getProvider('claude');
    expect(a.name).toBe('claude');
    expect(a).toBe(b);
  });

  it('throws a helpful error for unknown providers', () => {
    expect(() => getProvider('opencode')).toThrow(/Unknown provider: opencode/);
  });
});
