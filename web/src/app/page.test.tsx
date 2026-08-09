// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { shouldShowWizard } from './page';
import { ProfileSection } from '@/components/settings/sections/profile-section';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * When the welcome wizard is allowed to interrupt someone.
 *
 * It used to reappear 24 hours after a skip. That is how a user who had already
 * declined got asked to introduce themselves two days later, in front of a name
 * field pre-filled with their own name — the wizard saves the display name on
 * the step-1 transition, so the one thing it remembered was the thing that made
 * it look like it had remembered everything. The observed profile:
 * `onboardingComplete: false`, `onboardingSkippedAt: 1785901395676`, 2.4 days
 * earlier.
 *
 * "Skip for now" is a dismissal. A dismissal that silently expires is a claim
 * the UI does not honour, so skipping is now permanent and setup moved to
 * Settings → Profile.
 */
describe('when the welcome wizard may interrupt', () => {
  it('shows for a genuinely new profile', () => {
    expect(shouldShowWizard(false, null)).toBe(true);
  });

  it('never shows again once setup is completed', () => {
    expect(shouldShowWizard(true, null)).toBe(false);
  });

  /** The regression: a skip is a decision, and decisions do not expire. */
  it('never shows again once skipped, however long ago', () => {
    const skipped = 1785901395676; // the real timestamp from the report
    expect(shouldShowWizard(false, skipped)).toBe(false);

    const twoYears = skipped - 2 * 365 * 24 * 60 * 60 * 1000;
    expect(
      shouldShowWizard(false, twoYears),
      'the skip expired — the user is being asked again',
    ).toBe(false);
  });

  /**
   * The predicate must not read the wall clock. While it did, the answer
   * depended on when the app happened to be opened, which is untestable without
   * faking time and was the mechanism of the bug.
   */
  it('does not depend on the current time', () => {
    const now = vi.spyOn(Date, 'now');
    shouldShowWizard(false, 1785901395676);
    shouldShowWizard(false, null);
    expect(now, 'shouldShowWizard reads the clock').not.toHaveBeenCalled();
    now.mockRestore();
  });
});

/**
 * Skipping can only be permanent if there is a way back. Without this, a user
 * who skipped on day one could never reach the provider or connector steps
 * again — a worse outcome than the nagging it replaces.
 */
describe('setup can be re-run from Settings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ onboardingComplete: true, onboardingSkippedAt: Date.now() });
  });
  afterEach(() => {
    // Explicit: this suite has no global setup file, so renders would otherwise
    // accumulate and the second lookup finds two buttons.
    cleanup();
    useSettingsStore.setState({ onboardingComplete: false, onboardingSkippedAt: null });
  });

  it('offers a way back into the wizard', () => {
    render(<ProfileSection />);
    expect(screen.getByRole('button', { name: /run setup again/i })).toBeDefined();
  });

  /**
   * Both flags, not one. Clearing only `onboardingComplete` leaves a non-null
   * `onboardingSkippedAt` behind, and the predicate above would still refuse to
   * show the wizard — a button that reports success and does nothing.
   */
  it('clears both flags, so the wizard actually reappears', () => {
    render(<ProfileSection />);
    fireEvent.click(screen.getByRole('button', { name: /run setup again/i }));

    const { onboardingComplete, onboardingSkippedAt } = useSettingsStore.getState();
    expect(onboardingComplete).toBe(false);
    expect(onboardingSkippedAt, 'a stale skip timestamp still suppresses the wizard').toBeNull();
    expect(shouldShowWizard(onboardingComplete, onboardingSkippedAt)).toBe(true);
  });
});
