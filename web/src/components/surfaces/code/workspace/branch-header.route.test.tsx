// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * "Create PR" runs a subagent. It must run on the Code surface's route —
 * `model` + `providerConfig` from `resolveSendRoute` — or an OpenRouter-only
 * user's PR button resolves against the built-in registry and can never work.
 * And it must not carry the Anthropic key: the server reads the saved one.
 */

vi.mock('@/hooks/use-git-status', () => ({
  useGitStatus: () => ({
    status: { branch: 'feature/x', baseBranch: 'main', ahead: 2, behind: 0, files: [] },
  }),
}));
vi.mock('@/hooks/use-code-workspace', () => ({ useCodeWorkspace: () => ({ resetLayout: vi.fn() }) }));
vi.mock('@/hooks/use-electron', () => ({ useElectron: () => ({ showNotification: vi.fn() }) }));
vi.mock('@/lib/code-workspace/ipc', () => ({
  getGitLog: async () => [{ subject: 'Add x' }],
  pushGitBranch: async () => ({ ok: true, message: '' }),
  openExternalUrl: async () => {},
}));
vi.mock('./branch-picker', () => ({ BranchPicker: () => null }));
vi.mock('@/components/shared/folder-picker', () => ({ FolderPicker: () => null }));

import { BranchHeader } from './branch-header';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useCodeStore } from '@/stores/code-store';
import { resetServerCredentials, useServerCredentialsStore } from '@/hooks/use-builtin-access';

const fetchMock = vi.fn();

beforeEach(() => {
  resetServerCredentials();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/models'
      ? Response.json({ anthropic: false, bedrock: false })
      : Response.json({ ok: true, output: 'https://github.com/o/r/pull/1' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  useSettingsStore.setState({ anthropicApiKey: null, tierModels: {} });
  useCodeStore.setState({ modelRoute: null });
  useProviderStore.setState({
    providers: [
      {
        id: 'p-openrouter',
        presetId: 'openrouter',
        label: 'OpenRouter',
        enabled: true,
        createdAt: 0,
        transport: 'openai-compat',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: [
          {
            id: 'vendor/model-0',
            label: 'Model 0',
            capabilities: ['chat', 'code'],
            contextWindow: 200_000,
            pricing: { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },
          },
        ],
      },
    ] as never,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function createPr(): Promise<{ body: Record<string, unknown>; raw: string }> {
  render(
    <BranchHeader
      workspace="/tmp/repo"
      onFolderChange={() => {}}
      historyOpen={false}
      onToggleHistory={() => {}}
      baseBranch={null}
      onBaseBranchChange={() => {}}
    />,
  );
  // Let the server-credentials answer land so the route is decided on facts.
  await waitFor(() => expect(useServerCredentialsStore.getState().server).not.toBeNull());
  fireEvent.click(screen.getByText('Create PR'));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/subagent')).toBe(true),
  );
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/subagent')!;
  const raw = String((call[1] as RequestInit).body);
  return { body: JSON.parse(raw), raw };
}

describe('BranchHeader — Create PR', () => {
  it('sends the Code surface’s resolved route to /api/subagent', async () => {
    const { body } = await createPr();
    expect(body.model).toBe('vendor/model-0');
    expect((body.providerConfig as { providerId: string }).providerId).toBe('p-openrouter');
  });

  it('never sends the Anthropic key saved in Settings', async () => {
    useSettingsStore.setState({ anthropicApiKey: 'sk-ant-secret' });
    const { body, raw } = await createPr();
    expect(body).not.toHaveProperty('apiKey');
    expect(raw).not.toContain('sk-ant-secret');
  });
});
