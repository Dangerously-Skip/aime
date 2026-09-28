// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingWizard } from './onboarding-wizard';
import { hasUsableModel } from './step-done';
import { connectorDisplayName } from './step-connectors';
import { useSettingsStore } from '@/stores/settings-store';
import { useProviderStore } from '@/stores/provider-store';
import { resetServerCredentials } from '@/hooks/use-builtin-access';

/**
 * The flow: welcome → providers → connectors → done. These pin the step count
 * (progress was once derived with a magic offset), both directions of travel,
 * that there is always a way out, and — the bug this revision is about — that
 * the Done step tells the truth when no model was set up.
 */

const fetchMock = vi.fn();

// The OAuth dances open real windows; the wizard test only walks the flow.
vi.mock('@/lib/connectors/oauth', () => ({ startOAuthFlow: vi.fn() }));
vi.mock('@/lib/mcp/oauth-flow', () => ({ runMcpOAuthFlow: vi.fn() }));
vi.mock('@/lib/connectors/provisioner', () => ({ provisionConnector: vi.fn() }));

/** Headings in the order the wizard presents them (Done: the no-model variant). */
const STEP_HEADINGS = [/Welcome to/, /How should .* reach a model/, /Connect your apps/, /Almost there/];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  resetServerCredentials();
  useSettingsStore.setState({
    displayName: '',
    anthropicApiKey: null,
    onboardingComplete: false,
    onboardingSkippedAt: null,
  });
  useProviderStore.setState({ providers: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function nameAndContinue(name = 'Ada') {
  fireEvent.change(screen.getByPlaceholderText('Your name (optional)'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}
const continueBtn = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

describe('OnboardingWizard — step shape', () => {
  it('has four steps, and says which one you are on', () => {
    render(<OnboardingWizard />);
    expect(screen.getAllByTestId('onboarding-step-dot')).toHaveLength(4);
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    nameAndContinue();
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
  });

  it('is a labelled modal dialog', () => {
    render(<OnboardingWizard />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('onboarding-step-title');
    expect(document.getElementById('onboarding-step-title')?.textContent).toMatch(/Welcome to/);
  });

  it('has no feedback step pointing at a flag that does nothing', () => {
    render(<OnboardingWizard />);
    nameAndContinue();
    continueBtn();
    continueBtn();
    expect(screen.queryByText(/Help make this better/)).toBeNull();
    expect(screen.queryByText(/flag icon/)).toBeNull();
    const link = screen.getByRole('link', { name: /Open an issue on GitHub/ }) as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/Dangerously-Skip/aime/issues');
  });
});

describe('OnboardingWizard — navigation', () => {
  it('the name is optional', () => {
    render(<OnboardingWizard />);
    continueBtn();
    expect(screen.getByText(STEP_HEADINGS[1])).toBeTruthy();
  });

  it('walks forward through every step and backward to the first', () => {
    render(<OnboardingWizard />);
    nameAndContinue();
    for (let i = 1; i < STEP_HEADINGS.length; i++) {
      expect(screen.getByText(STEP_HEADINGS[i])).toBeTruthy();
      if (i < STEP_HEADINGS.length - 1) continueBtn();
    }
    for (let i = STEP_HEADINGS.length - 2; i >= 0; i--) {
      fireEvent.click(screen.getByText('Back'));
      expect(screen.getByText(STEP_HEADINGS[i])).toBeTruthy();
    }
    expect((screen.getByPlaceholderText('Your name (optional)') as HTMLInputElement).value).toBe('Ada');
  });

  it('offers one way forward on the provider step, not two different skips', () => {
    render(<OnboardingWizard />);
    nameAndContinue();
    expect(screen.queryByText(/Skip — set up later/)).toBeNull();
    expect(screen.getAllByText(/skip/i)).toHaveLength(1); // the wizard's own "Skip setup for now"
  });
});

describe('OnboardingWizard — Done tells the truth', () => {
  it('with no model, says so and offers to connect one', () => {
    render(<OnboardingWizard />);
    nameAndContinue();
    continueBtn(); // providers → connectors, nothing configured
    continueBtn(); // connectors → done
    expect(screen.getByText('Almost there')).toBeTruthy();
    expect(screen.queryByText(/all set up/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Connect a model' }));
    expect(screen.getByText(STEP_HEADINGS[1])).toBeTruthy();
  });

  it('with no model, can still finish', () => {
    render(<OnboardingWizard />);
    nameAndContinue('Grace');
    continueBtn();
    continueBtn();
    fireEvent.click(screen.getByRole('button', { name: 'Continue without a model' }));
    const s = useSettingsStore.getState();
    expect(s.onboardingComplete).toBe(true);
    expect(s.displayName).toBe('Grace');
  });

  it('with a model, congratulates — correctly spelled — and has ONE way into the app', async () => {
    render(<OnboardingWizard />);
    nameAndContinue('Grace');
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-ant-wizard' } });
    fireEvent.click(screen.getByText('Save & verify'));
    await waitFor(() => expect(useSettingsStore.getState().anthropicApiKey).toBe('sk-ant-wizard'));

    continueBtn();
    continueBtn();
    expect(screen.getByText('Nice work, human!')).toBeTruthy();
    expect(screen.getByText("You're all set up.")).toBeTruthy();
    expect(screen.getByText('Model access')).toBeTruthy();
    // No second "Go to AIME" under the primary button.
    expect(screen.queryByText(/^Go to /)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Start using/ }));
    expect(useSettingsStore.getState().onboardingComplete).toBe(true);
  });
});

describe('OnboardingWizard — never a trap', () => {
  it('defers from the setup steps', () => {
    render(<OnboardingWizard />);
    fireEvent.click(screen.getByText('Skip setup for now'));
    expect(useSettingsStore.getState().onboardingSkippedAt).not.toBeNull();
    expect(useSettingsStore.getState().onboardingComplete).toBe(false);
  });

  it('Escape leaves from any step without needing a button: defers early, completes on Done', () => {
    // The unexplained "couldn't get past the summary screen" report is why an
    // exit that does not depend on a click exists at all.
    const { unmount } = render(<OnboardingWizard />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useSettingsStore.getState().onboardingSkippedAt).not.toBeNull();
    unmount();

    useSettingsStore.setState({ onboardingSkippedAt: null });
    render(<OnboardingWizard />);
    nameAndContinue();
    continueBtn();
    continueBtn();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useSettingsStore.getState().onboardingComplete).toBe(true);
  });

  it('keeps Tab inside the dialog', () => {
    render(<OnboardingWizard />);
    const dialog = screen.getByRole('dialog');
    const buttons = dialog.querySelectorAll('button');
    const last = buttons[buttons.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
  });
});

describe('helpers', () => {
  it('hasUsableModel: a key, server access, or a provider with models/key', () => {
    const none = { anthropicApiKey: null, providers: [], serverAccess: false };
    expect(hasUsableModel(none)).toBe(false);
    expect(hasUsableModel({ ...none, serverAccess: true })).toBe(true);
    expect(hasUsableModel({ ...none, providers: [{ enabled: true, models: [], hasCredentials: false }] })).toBe(false);
    expect(hasUsableModel({ ...none, providers: [{ enabled: true, models: [{ id: 'm', label: 'm' }] }] })).toBe(true);
    expect(hasUsableModel({ ...none, providers: [{ enabled: false, models: [{ id: 'm', label: 'm' }] }] })).toBe(false);
  });

  it('connectorDisplayName: readable names, not ids', () => {
    expect(connectorDisplayName('m365-graph')).toBe('Microsoft 365 (Mail + Calendar)');
    expect(connectorDisplayName('google-workspace')).toBe('Google Workspace');
  });
});
