// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingWizard } from './onboarding-wizard';
import { useSettingsStore } from '@/stores/settings-store';
import { useProviderStore } from '@/stores/provider-store';

/**
 * The org "select your team" step is gone — inference-provider setup takes its
 * slot. These tests pin the two things that broke when the branch was deleted:
 * the step *count* (the progress dots and the `Skip for now` condition were
 * derived from it with a magic offset) and the ability to walk the flow in both
 * directions without a dead end.
 */

const fetchMock = vi.fn();

// The OAuth dances open real windows; the wizard test only walks the flow.
vi.mock('@/lib/connectors/oauth', () => ({ startOAuthFlow: vi.fn() }));
vi.mock('@/lib/mcp/oauth-flow', () => ({ runMcpOAuthFlow: vi.fn() }));
vi.mock('@/lib/connectors/provisioner', () => ({ provisionConnector: vi.fn() }));

/** Headings in the order the wizard presents them. */
const STEP_HEADINGS = [
  /Welcome to/,
  /How should .* reach a model/,
  /Connect your apps/,
  /Nice work human/,
  /Help make this better/,
];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
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

/** Advance past the welcome step (it needs a name before Continue enables). */
function nameAndContinue(name = 'Ada') {
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: name } });
  fireEvent.click(screen.getByText('Continue'));
}

describe('OnboardingWizard — step shape', () => {
  it('renders one progress dot per step (5)', () => {
    render(<OnboardingWizard />);
    expect(screen.getAllByTestId('onboarding-step-dot')).toHaveLength(5);
  });

  it('puts inference-provider setup where the team step used to be (step 2)', () => {
    render(<OnboardingWizard />);
    nameAndContinue();

    // The replacement, not the old org picker.
    expect(screen.getByText(/How should .* reach a model/)).toBeTruthy();
    expect(screen.getByText('Anthropic API key')).toBeTruthy();
    expect(screen.getByText('OpenRouter')).toBeTruthy();
    expect(screen.queryByText(/Select your team/i)).toBeNull();
  });

  it('never shows a team picker on any step', () => {
    render(<OnboardingWizard />);
    nameAndContinue();
    for (let i = 1; i < STEP_HEADINGS.length; i++) {
      expect(screen.queryByText(/Select your team/i)).toBeNull();
      expect(screen.queryByText(/configure your AI access automatically/i)).toBeNull();
      if (i < STEP_HEADINGS.length - 1) {
        fireEvent.click(screen.getByText(/^(Continue|Skip — set up later)$/));
      }
    }
  });
});

describe('OnboardingWizard — navigation', () => {
  it('walks forward through every step to the final one', () => {
    render(<OnboardingWizard />);
    expect(screen.getByText(STEP_HEADINGS[0])).toBeTruthy();
    nameAndContinue();

    for (let i = 1; i < STEP_HEADINGS.length; i++) {
      expect(screen.getByText(STEP_HEADINGS[i])).toBeTruthy();
      if (i < STEP_HEADINGS.length - 1) {
        // provider step's forward control is the skip when nothing is configured
        fireEvent.click(screen.getByText(/^(Continue|Skip — set up later)$/));
      }
    }
    // the last step completes onboarding rather than advancing into a dead end
    expect(screen.getByText('Get started')).toBeTruthy();
  });

  it('walks backward from the final step to the first', () => {
    render(<OnboardingWizard />);
    nameAndContinue();
    for (let i = 1; i < STEP_HEADINGS.length - 1; i++) {
      fireEvent.click(screen.getByText(/^(Continue|Skip — set up later)$/));
    }
    expect(screen.getByText(STEP_HEADINGS[4])).toBeTruthy();

    for (let i = 3; i >= 1; i--) {
      fireEvent.click(screen.getByText('Back'));
      expect(screen.getByText(STEP_HEADINGS[i])).toBeTruthy();
    }
    // step 2 → step 1 lands on welcome, with the name still in the field
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText(STEP_HEADINGS[0])).toBeTruthy();
    expect((screen.getByPlaceholderText('Your name') as HTMLInputElement).value).toBe('Ada');
  });

  it('advances the active dot with the step', () => {
    render(<OnboardingWizard />);
    const activeIndex = () =>
      screen.getAllByTestId('onboarding-step-dot').findIndex((d) => d.className.includes('w-6'));
    expect(activeIndex()).toBe(0);
    nameAndContinue();
    expect(activeIndex()).toBe(1);
    fireEvent.click(screen.getByText(/Skip — set up later/));
    expect(activeIndex()).toBe(2);
  });
});

describe('OnboardingWizard — the escape hatch', () => {
  /**
   * Onboarding renders in front of the entire app, so a step with no way out
   * locks the user out of the product. A report of being unable to get past the
   * summary screen reproduced on neither Chromium nor real Electron, so the
   * cause is still unknown — which is exactly why every step must have an exit
   * that does not depend on the step's own primary button working.
   */
  it('offers an escape on EVERY step, so onboarding can never trap the user', () => {
    render(<OnboardingWizard />);
    const escapes = () =>
      screen.queryAllByText(/Skip for now|Go to /).length;

    expect(escapes()).toBeGreaterThan(0); // welcome
    nameAndContinue();
    expect(escapes()).toBeGreaterThan(0); // providers
    fireEvent.click(screen.getByText(/Skip — set up later/));
    expect(escapes()).toBeGreaterThan(0); // connectors
    fireEvent.click(screen.getByText('Continue'));
    expect(escapes()).toBeGreaterThan(0); // done — the reported screen
    fireEvent.click(screen.getByText('Continue'));
    expect(escapes()).toBeGreaterThan(0); // feedback
  });

  it('defers on the setup steps and COMPLETES on the tail', () => {
    render(<OnboardingWizard />);
    // Setup steps: "Skip for now" only postpones, so the wizard returns later.
    expect(screen.getByText('Skip for now')).toBeTruthy();
    fireEvent.click(screen.getByText('Skip for now'));
    expect(useSettingsStore.getState().onboardingSkippedAt).not.toBeNull();
    expect(useSettingsStore.getState().onboardingComplete).toBe(false);
  });

  it('the summary screen can reach the app without using its Continue button', () => {
    // The specific trap: if Continue fails on "Nice work human!", this is the
    // only remaining way in.
    render(<OnboardingWizard />);
    nameAndContinue();
    fireEvent.click(screen.getByText(/Skip — set up later/));
    fireEvent.click(screen.getByText('Continue')); // -> done
    expect(screen.getByText(/Nice work human/)).toBeTruthy();

    fireEvent.click(screen.getByText(/^Go to /));
    expect(useSettingsStore.getState().onboardingComplete).toBe(true);
  });
});

describe('OnboardingWizard — what it saves', () => {
  it('persists the display name on leaving the welcome step', () => {
    render(<OnboardingWizard />);
    nameAndContinue('Grace');
    expect(useSettingsStore.getState().displayName).toBe('Grace');
  });

  it('the provider step writes the key itself, and the summary reflects it', async () => {
    render(<OnboardingWizard />);
    nameAndContinue('Grace');

    fireEvent.change(screen.getByPlaceholderText('sk-ant-...'), {
      target: { value: 'sk-ant-wizard' },
    });
    fireEvent.click(screen.getByText('Save & verify'));
    await waitFor(() =>
      expect(useSettingsStore.getState().anthropicApiKey).toBe('sk-ant-wizard'),
    );

    fireEvent.click(screen.getByText('Continue')); // providers → connectors
    fireEvent.click(screen.getByText('Continue')); // connectors → done
    expect(screen.getByText(/Nice work human/)).toBeTruthy();
    // the summary line that replaced "Team"
    expect(screen.getByText('Model access')).toBeTruthy();
    expect(screen.getByText('Anthropic')).toBeTruthy();
  });

  it('completes onboarding from the final step', () => {
    render(<OnboardingWizard />);
    nameAndContinue('Grace');
    fireEvent.click(screen.getByText(/Skip — set up later/));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Get started'));

    const s = useSettingsStore.getState();
    expect(s.onboardingComplete).toBe(true);
    expect(s.displayName).toBe('Grace');
  });
});
