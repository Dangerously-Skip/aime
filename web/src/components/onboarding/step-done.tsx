"use client";

import { useSettingsStore } from "@/stores/settings-store";
import { useProviderStore } from "@/stores/provider-store";
import { ArrowLeft, Check } from "lucide-react";
import Image from "next/image";

interface StepDoneProps {
  displayName: string;
  connectedApps: string[];
  onContinue: () => void;
  onBack: () => void;
}

export function StepDone({
  displayName,
  connectedApps,
  onContinue,
  onBack,
}: StepDoneProps) {
  // Read the provider state rather than taking it as a prop: the provider step
  // writes straight to these stores, so this is the actual configured truth.
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const providers = useProviderStore((s) => s.providers);

  // Deduped: the Anthropic path now writes BOTH the settings key and a provider
  // row (one shared setup flow, rather than a bespoke branch per path), so the
  // two sources name the same thing and the summary read "Anthropic, Anthropic".
  // A Set also covers two providers a user happened to give the same label.
  const providerNames = [
    ...new Set([
      ...(anthropicApiKey ? ["Anthropic"] : []),
      ...providers.map((p) => p.label),
    ]),
  ];

  const summaryItems: { label: string; value: string }[] = [];

  if (displayName.trim()) {
    summaryItems.push({ label: "Name", value: displayName.trim() });
  }
  if (providerNames.length > 0) {
    summaryItems.push({ label: "Model access", value: providerNames.join(", ") });
  }
  if (connectedApps.length > 0) {
    summaryItems.push({
      label: "Connected",
      value: connectedApps
        .map((id) => id.charAt(0).toUpperCase() + id.slice(1))
        .join(", "),
    });
  }

  return (
    <div className="flex flex-col items-center text-center">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 self-start"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>

      <Image
        src="/thumbs-up-robot.png"
        alt="Robot thumbs up"
        width={80}
        height={80}
        className="mb-5"
      />

      <h2 className="text-xl font-semibold tracking-tight">Nice work human!</h2>
      <p className="text-sm text-muted-foreground mt-2 mb-6">
        You are all setup.
      </p>

      {summaryItems.length > 0 && (
        <div className="w-full max-w-xs mb-6 space-y-2">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 text-left"
            >
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              <div className="min-w-0">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <p className="text-sm font-medium truncate">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onContinue}
        className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
