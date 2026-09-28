"use client";

import { useSettingsStore } from "@/stores/settings-store";
import { useProviderStore, type ConfiguredProvider } from "@/stores/provider-store";
import { useBuiltinAccess } from "@/hooks/use-builtin-access";
import { APP_NAME } from "@/config/branding";
import { AlertCircle, ArrowLeft, Check } from "lucide-react";
import Image from "next/image";
import { connectorDisplayName } from "./step-connectors";

/** Where the Done step sends people with a bug or an idea. */
export const ISSUES_URL = "https://github.com/Dangerously-Skip/aime/issues";

interface StepDoneProps {
  displayName: string;
  connectedApps: string[];
  /** Finish onboarding and enter the app. */
  onComplete: () => void;
  /** Go back to the provider step. */
  onConnectModel: () => void;
  onBack: () => void;
}

/**
 * Is there ANY model this install can reach? A provider counts once it has
 * models or a stored key; a keyless provider with no models reaches nothing.
 */
export function hasUsableModel(opts: {
  anthropicApiKey: string | null;
  providers: ReadonlyArray<Pick<ConfiguredProvider, "enabled" | "models" | "hasCredentials">>;
  serverAccess: boolean;
}): boolean {
  if (opts.anthropicApiKey || opts.serverAccess) return true;
  return opts.providers.some((p) => p.enabled && (p.models.length > 0 || !!p.hasCredentials));
}

/**
 * The last step, and it has to tell the truth.
 *
 * It used to say "Nice work human! You are all setup." whatever had happened —
 * including straight after "Skip — set up later" on the provider step, when
 * nothing at all could answer a message. Now, with no model, it says so and
 * offers the way back.
 */
export function StepDone({
  displayName,
  connectedApps,
  onComplete,
  onConnectModel,
  onBack,
}: StepDoneProps) {
  // Read the provider state rather than taking it as a prop: the provider step
  // writes straight to these stores, so this is the actual configured truth.
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const providers = useProviderStore((s) => s.providers);
  const { hasAnthropicKey, hasBedrock } = useBuiltinAccess();
  const ready = hasUsableModel({
    anthropicApiKey,
    providers,
    serverAccess: hasAnthropicKey || hasBedrock,
  });

  // Deduped: the Anthropic path writes BOTH the settings key and a provider row,
  // so the two sources name the same thing.
  const providerNames = [
    ...new Set([
      ...(anthropicApiKey ? ["Anthropic"] : []),
      ...providers.filter((p) => p.enabled).map((p) => p.label),
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
      value: connectedApps.map(connectorDisplayName).join(", "),
    });
  }

  return (
    <div className="flex flex-1 flex-col items-center text-center">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 self-start"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>

      {ready ? (
        <Image
          src="/thumbs-up-robot.png"
          alt=""
          width={80}
          height={80}
          className="mb-5"
        />
      ) : (
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
        </div>
      )}

      <h2 id="onboarding-step-title" tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
        {ready ? "Nice work, human!" : "Almost there"}
      </h2>
      <p className="text-sm text-muted-foreground mt-2 mb-6 max-w-xs">
        {ready
          ? "You're all set up."
          : `No model is connected yet, so ${APP_NAME} can't answer anything. Connect one now, or later in Settings → Models & API keys.`}
      </p>

      {summaryItems.length > 0 && (
        <div className="w-full max-w-xs mb-6 space-y-2">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 text-left"
            >
              <Check className="h-4 w-4 text-green-500 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <p className="text-sm font-medium truncate">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {ready ? (
        <button
          type="button"
          onClick={onComplete}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Start using {APP_NAME}
        </button>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onConnectModel}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Connect a model
          </button>
          <button
            type="button"
            onClick={onComplete}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Continue without a model
          </button>
        </div>
      )}

      <p className="mt-auto pt-6 text-[11px] text-muted-foreground">
        Found a bug or have an idea?{" "}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
          Open an issue on GitHub
        </a>
      </p>
    </div>
  );
}
