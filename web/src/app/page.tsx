"use client";

import { AppShell } from "@/components/layout/app-shell";
import { useHydrated, useRehydrated } from "@/components/store-hydration";
import { useSettingsStore } from "@/stores/settings-store";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Module-scoped: reads the wall clock, which must not happen in a component body. */
function shouldShowWizard(
  onboardingComplete: boolean,
  onboardingSkippedAt: number | null
): boolean {
  if (onboardingComplete) return false;
  return onboardingSkippedAt === null || Date.now() - onboardingSkippedAt > ONE_DAY_MS;
}

export default function Home() {
  const hydrated = useHydrated();
  /**
   * The wizard waits for REAL state, not merely for permission to render.
   *
   * `onboardingComplete: false` is the default, and it is indistinguishable
   * from "this user is new" — so showing the wizard before the persisted value
   * arrives asks a returning user to introduce themselves again. That is what
   * the 3s hydration timeout was doing on every slow start.
   */
  const rehydrated = useRehydrated();
  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete);
  const onboardingSkippedAt = useSettingsStore((s) => s.onboardingSkippedAt);

  if (!hydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  if (rehydrated && shouldShowWizard(onboardingComplete, onboardingSkippedAt)) {
    return <OnboardingWizard />;
  }

  return <AppShell />;
}
