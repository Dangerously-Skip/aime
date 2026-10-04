/*
 * Lives outside app/page.tsx because a page module may only export what Next
 * allows (default, metadata, …); an extra export fails Next's generated page
 * types, so `tsc` broke whenever a local build had left `.next/types` behind.
 */

/**
 * Skipping setup is a decision, not a snooze.
 *
 * This used to re-show the wizard 24 hours after a skip. That is how a user who
 * had already declined got asked to introduce themselves two days later, in
 * front of a name field pre-filled with their own name — the wizard saves the
 * display name on the step-1 transition, so the one thing it remembered was the
 * thing that made it look like it had remembered everything.
 *
 * The snooze was also invisible. "Skip for now" is a dismissal, and a dismissal
 * that quietly expires is a claim the UI does not honour.
 *
 * So a skip is permanent, and setup is re-runnable from Settings → Profile.
 * `onboardingSkippedAt` stays a timestamp rather than becoming a boolean: it
 * costs nothing, it is already persisted in every profile, and knowing WHEN
 * someone declined is worth more than knowing only that they did.
 *
 * No wall clock is read here any more, which is why this is a plain predicate —
 * and `page.test.tsx` asserts that, because reading the clock is what made the
 * answer depend on when the app happened to be opened.
 */
export function shouldShowWizard(
  onboardingComplete: boolean,
  onboardingSkippedAt: number | null
): boolean {
  return !onboardingComplete && onboardingSkippedAt === null;
}
