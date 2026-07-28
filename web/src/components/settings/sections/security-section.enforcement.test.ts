import { describe, it, expect, vi } from 'vitest';
import { SECURITY_TOGGLES, type SecurityKey } from './security-section';

/**
 * A toggle that says `enforcement: 'enforced'` must actually be refused by the
 * server. This test is what makes that field a claim rather than a comment.
 *
 * ## Why this exists
 *
 * Four security toggles shipped describing themselves as boundaries while doing
 * nothing of the kind. `disableBashTool` said it "completely removes the Bash
 * tool" and filtered a name out of the SDK's AUTO-APPROVE list on a run with
 * `permissionMode: 'bypassPermissions'` — Bash kept working. The others appended
 * a sentence to the system prompt. Every one of them had passing tests, because
 * the tests asserted the list was filtered, which was true and irrelevant.
 *
 * The guidance "don't mock the boundary a test exists to prove" was already
 * written down when all four shipped. So this is the executable form: each
 * enforced toggle is driven through the REAL `canUseTool` — the one hook that
 * runs whatever `permissionMode` says — and must come back `deny`.
 *
 * ## If you are here because this failed
 *
 * You either added a toggle without a probe (add one below), or declared
 * `'enforced'` for something that isn't. Do not "fix" it by relaxing the
 * assertion or flipping the field to 'guidance' to get green — flip it only if
 * guidance is genuinely what you meant, and make the description say so too.
 */

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (a: unknown) => queryMock(a),
  tool: (name: string, d: string, s: unknown, h: unknown) => ({ name, d, s, h }),
  createSdkMcpServer: (c: unknown) => c,
}));

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: { toolUseID: string },
) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>;

/** Assemble the real SDK options for a turn and hand back its canUseTool. */
async function canUseToolFor(params: Record<string, unknown>): Promise<CanUseTool> {
  const { ClaudeProvider } = await import('@/lib/providers/claude-provider');
  queryMock.mockImplementation(async function* () {});
  const provider = new ClaudeProvider();
  for await (const _ of provider.query({ prompt: 'x', chatId: 'c1', ...params } as never)) {
    /* drain */
  }
  return queryMock.mock.calls.at(-1)![0].options.canUseTool as CanUseTool;
}

/**
 * How each enforced toggle is proved: the request the route would send with it
 * on, and a tool call that must be refused because of it.
 *
 * Keyed by toggle so a NEW enforced toggle with no entry fails the completeness
 * check below — the failure mode being guarded is "someone added a control and
 * nobody noticed it wasn't wired", which is exactly how cowork shipped without a
 * widget handler.
 */
const PROBES: Record<
  SecurityKey,
  {
    /** What `route.ts` sends the provider when this toggle is on. */
    params: Record<string, unknown>;
    tool: string;
    input: Record<string, unknown>;
    /** The refusal must be legible to the agent, not just a bare deny. */
    message: RegExp;
  }
> = {
  disableBashTool: {
    // The route turns this into deniedTools; see its own tests for that half.
    params: { deniedTools: ['Bash', 'BashOutput', 'KillShell'] },
    tool: 'Bash',
    input: { command: 'rm -rf ~/x' },
    message: /not available in this session/i,
  },
  restrictToProjectFolder: {
    params: { cwd: '/Users/x/projects/app', securitySettings: { restrictToProjectFolder: true } },
    tool: 'Write',
    input: { file_path: '/Users/x/.ssh/authorized_keys' },
    message: /outside the working directory/i,
  },
  blockDangerousCommands: {
    // No onInputRequest ⇒ nobody can be asked, so it must refuse rather than run.
    // The interactive half (it prompts, and honours the answer) is covered in
    // claude-provider.test.ts and approval-gate.integration.test.ts.
    params: { securitySettings: { blockDangerousCommands: true } },
    tool: 'Bash',
    input: { command: 'sudo rm -rf /var/log' },
    message: /needs the user's approval|cannot ask/i,
  },
  // Declared guidance, so it gets no probe — and the test below proves the
  // declaration is honest rather than a way to opt out of being checked.
  blockNetworkCommands: null as never,
};

const enforced = SECURITY_TOGGLES.filter((t) => t.enforcement === 'enforced');
const guidance = SECURITY_TOGGLES.filter((t) => t.enforcement === 'guidance');

describe('every toggle that claims enforcement is enforced', () => {
  it('has a probe for each enforced toggle — a new one cannot slip through', () => {
    for (const toggle of enforced) {
      expect(PROBES[toggle.key], `no probe for '${toggle.key}'`).toBeTruthy();
    }
    expect(enforced.length).toBeGreaterThan(0);
  });

  it.each(enforced.map((t) => [t.key, t.label] as const))(
    '%s (%s) is refused by the real canUseTool',
    async (key) => {
      const probe = PROBES[key];
      const canUseTool = await canUseToolFor(probe.params);
      const result = await canUseTool(probe.tool, probe.input, { toolUseID: `probe-${key}` });

      expect(result.behavior, `${key} claims to be enforced but allowed the call`).toBe('deny');
      expect(result.message ?? '').toMatch(probe.message);
    },
  );

  it('leaves an unrelated call alone — a gate that denies everything proves nothing', async () => {
    for (const toggle of enforced) {
      const canUseTool = await canUseToolFor(PROBES[toggle.key].params);
      const ok = await canUseTool('Glob', { pattern: '**/*.ts' }, { toolUseID: `ctl-${toggle.key}` });
      expect(ok.behavior, `${toggle.key} denied an unrelated tool`).toBe('allow');
    }
  });
});

describe('every toggle that admits to being guidance says so out loud', () => {
  it.each(guidance.map((t) => [t.key, t.description] as const))(
    '%s tells the user it is not enforced',
    (_key, description) => {
      // The honest wording is the whole value of the 'guidance' label: a user
      // who cannot tell a boundary from a request calibrates on the label.
      expect(description).toMatch(/instructs|guidance|not enforced/i);
    },
  );

  it('does not describe itself as blocking in the label', () => {
    for (const toggle of guidance) {
      expect(toggle.label, toggle.key).not.toMatch(/^Block\b/);
    }
  });
});
