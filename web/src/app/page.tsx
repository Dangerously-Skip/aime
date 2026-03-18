"use client";

import { AppShell } from "@/components/layout/app-shell";
import { useHydrated } from "@/components/store-hydration";
import { useSettingsStore } from "@/stores/settings-store";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export default function Home() {
  const hydrated = useHydrated();
  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete);
  const onboardingSkippedAt = useSettingsStore((s) => s.onboardingSkippedAt);

  if (!hydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  const showWizard =
    !onboardingComplete &&
    (onboardingSkippedAt === null ||
      Date.now() - onboardingSkippedAt > ONE_DAY_MS);

  if (showWizard) {
    return <OnboardingWizard />;
  }

  return <AppShell />;
}
