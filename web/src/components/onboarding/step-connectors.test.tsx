// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { StepConnectors } from './step-connectors';
import { useConnectorStore } from '@/stores/connector-store';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * The regression these tests exist for: onboarding featured five connectors but
 * only implemented the plain oauth2 flow, so clicking GitHub, Atlassian, Miro or
 * Buildkite called setOnboardingSkippedAt() and jumped to Customize — the user
 * asked to connect an app and onboarding *ended*.
 *
 * The OAuth browser dances are stubbed (they open real windows); the orchestrator
 * and the store writes are real, because "did the connector actually end up
 * connected" is the thing being claimed.
 */

const startOAuthFlow = vi.fn();
const runMcpOAuthFlow = vi.fn();
const provisionConnector = vi.fn();

vi.mock('@/lib/connectors/oauth', () => ({ startOAuthFlow: (...a: unknown[]) => startOAuthFlow(...a) }));
vi.mock('@/lib/mcp/oauth-flow', () => ({ runMcpOAuthFlow: (...a: unknown[]) => runMcpOAuthFlow(...a) }));
vi.mock('@/lib/connectors/provisioner', () => ({
  provisionConnector: (...a: unknown[]) => provisionConnector(...a),
}));

const onConnectorConnected = vi.fn();
const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  startOAuthFlow.mockResolvedValue({ accessToken: 'oauth-token', expiresIn: 3600 });
  runMcpOAuthFlow.mockResolvedValue({ accessToken: 'mcp-token', expiresIn: 3600 });
  provisionConnector.mockResolvedValue(undefined);
  useConnectorStore.setState({ connectorStates: {} });
  useSettingsStore.setState({ onboardingSkippedAt: null });
});

afterEach(cleanup);

const renderStep = () =>
  render(
    <StepConnectors onConnectorConnected={onConnectorConnected} onContinue={noop} onBack={noop} />,
  );

const connectButtonFor = (name: string) => {
  const card = screen.getByText(name).closest('div.flex.items-center') as HTMLElement;
  return card.querySelector('button') as HTMLButtonElement;
};

describe('StepConnectors — onboarding no longer abandons itself', () => {
  it('shows the five featured connectors', () => {
    renderStep();
    for (const name of ['GitHub', 'Atlassian', 'Miro', 'Buildkite']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it.each([
    ['Atlassian', 'atlassian'],
    ['Miro', 'miro'],
  ])('%s connects in place via the DCR flow', async (label, id) => {
    renderStep();
    fireEvent.click(connectButtonFor(label));

    await waitFor(() => expect(runMcpOAuthFlow).toHaveBeenCalled());
    await waitFor(() =>
      expect(useConnectorStore.getState().connectorStates[id]?.authenticated).toBe(true),
    );
    // onboarding must still be running
    expect(useSettingsStore.getState().onboardingSkippedAt).toBeNull();
    expect(onConnectorConnected).toHaveBeenCalledWith(id);
  });

  it('does not double-provision an mcp-oauth connector (the exchange route already wrote it)', async () => {
    renderStep();
    fireEvent.click(connectButtonFor('Atlassian'));
    await waitFor(() => expect(runMcpOAuthFlow).toHaveBeenCalled());
    expect(provisionConnector).not.toHaveBeenCalled();
  });

  it.each([
    ['GitHub', 'github'],
    ['Buildkite', 'buildkite'],
  ])('%s collects a token inline and connects without leaving onboarding', async (label, id) => {
    renderStep();
    fireEvent.click(connectButtonFor(label));

    // an in-card field appears rather than a jump to Customize
    const input = await screen.findByLabelText('API token');
    fireEvent.change(input, { target: { value: 'tok_123' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(useConnectorStore.getState().connectorStates[id]?.authenticated).toBe(true),
    );
    expect(useSettingsStore.getState().onboardingSkippedAt).toBeNull();
    // the token reached the provisioner, which builds the entry server-side
    expect(provisionConnector).toHaveBeenCalled();
    expect(provisionConnector.mock.calls[0][1]).toBe('tok_123');
  });

  it('shows the registry hint so the user knows where to get the token', async () => {
    renderStep();
    fireEvent.click(connectButtonFor('GitHub'));
    expect(await screen.findByText(/github\.com\/settings\/tokens/)).toBeTruthy();
  });

  it('cancelling the inline prompt leaves the connector unconnected and onboarding intact', async () => {
    renderStep();
    fireEvent.click(connectButtonFor('GitHub'));
    fireEvent.click(await screen.findByText('Cancel'));

    await waitFor(() =>
      expect(useConnectorStore.getState().connectorStates['github']?.authenticated).not.toBe(true),
    );
    expect(provisionConnector).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().onboardingSkippedAt).toBeNull();
    // and the Connect button is available again
    expect(connectButtonFor('GitHub')).toBeTruthy();
  });

  it('connects the oauth2 connector inline as before', async () => {
    renderStep();
    fireEvent.click(connectButtonFor('Microsoft 365 (Mail + Calendar)'));

    await waitFor(() => expect(startOAuthFlow).toHaveBeenCalled());
    await waitFor(() =>
      expect(useConnectorStore.getState().connectorStates['m365-graph']?.authenticated).toBe(true),
    );
  });
});

describe('StepConnectors — failures are reported, not swallowed', () => {
  it('surfaces a flow error in the card and does not mark it connected', async () => {
    runMcpOAuthFlow.mockRejectedValue(new Error('Server rejected the client'));
    renderStep();
    fireEvent.click(connectButtonFor('Atlassian'));

    expect(await screen.findByText(/Server rejected the client/)).toBeTruthy();
    expect(useConnectorStore.getState().connectorStates['atlassian']?.authenticated).not.toBe(true);
  });

  it('treats a closed auth window as a cancellation with no error shown', async () => {
    runMcpOAuthFlow.mockRejectedValue(new Error('OAuth flow was canceled'));
    renderStep();
    fireEvent.click(connectButtonFor('Miro'));

    await waitFor(() => expect(runMcpOAuthFlow).toHaveBeenCalled());
    expect(screen.queryByText(/canceled/i)).toBeNull();
  });
});
