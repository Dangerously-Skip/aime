"use client";

import { AppShell } from "@/components/layout/app-shell";
import { useHydrated } from "@/components/store-hydration";

export default function Home() {
  const hydrated = useHydrated();

  if (!hydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  return <AppShell />;
}
