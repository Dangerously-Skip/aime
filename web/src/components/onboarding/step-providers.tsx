"use client";

import { useMemo, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useProviderStore } from "@/stores/provider-store";
import { PROVIDER_PRESETS, getPreset } from "@/lib/models/providers";
import type { CredentialField, ScannedModel } from "@/lib/models/providers";
import { planProviderSetup, executeProviderSetup } from "@/lib/models/provider-setup";
import { ProviderFields, providerHint } from "@/components/shared/provider-fields";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, KeyRound, Globe, HardDrive, Loader2, MoreHorizontal } from "lucide-react";

/**
 * Onboarding — choose how AIME reaches a model (the P1.6 guided setup).
 *
 * Three recommended paths stay up front, because a first-run screen listing
 * eleven presets is a worse experience than one that makes a choice for you.
 * But the other eight are now reachable rather than absent: the previous version
 * hardcoded `anthropic | openrouter | local` and had no route to Bedrock,
 * Vertex, OpenAI, Gemini, Groq, Azure, Fal or a custom endpoint at all.
 *
 * Every path — recommended or not — goes through the same
 * `planProviderSetup` / `executeProviderSetup` as Settings, and renders the same
 * `ProviderFields`. There used to be a second, bespoke implementation here, and
 * it is why onboarding never learned about the fields Bedrock and Vertex need.
 */

interface StepProvidersProps {
  onContinue: () => void;
  onBack: () => void;
}

async function saveCredentials(providerId: string, values: Record<string, string>): Promise<void> {
  const res = await fetch("/api/models/providers/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, values }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(typeof d.error === "string" ? d.error : `Could not store key (${res.status})`);
  }
}

async function scan(presetId: string, opts: { apiKey?: string; baseUrl?: string }): Promise<ScannedModel[]> {
  const res = await fetch("/api/models/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presetId, apiKey: opts.apiKey || undefined, baseUrl: opts.baseUrl || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Scan failed (${res.status})`);
  return (data.models ?? []) as ScannedModel[];
}

/** The three the first-run screen leads with, and why each is worth leading with. */
export const RECOMMENDED_PATHS = [
  {
    presetId: "anthropic",
    icon: KeyRound,
    blurb: "Claude direct — the simplest path. Get a key at console.anthropic.com.",
  },
  {
    presetId: "openrouter",
    icon: Globe,
    blurb: "One key, hundreds of models (Claude, GPT, Kimi, Gemini…). openrouter.ai/keys.",
  },
  {
    presetId: "local",
    icon: HardDrive,
    blurb: "No key, no cloud — models running on this machine.",
  },
] as const;

/** Everything else, in catalogue order. */
export function otherPresetIds(): string[] {
  const recommended = new Set(RECOMMENDED_PATHS.map((p) => p.presetId as string));
  return PROVIDER_PRESETS.filter((p) => !recommended.has(p.id)).map((p) => p.id);
}

export function StepProviders({ onContinue, onBack }: StepProvidersProps) {
  /**
   * What the user has ALREADY set up, which this step used to ignore entirely.
   *
   * It opened on a blank Anthropic form every time, whatever was configured. A
   * user who had set up OpenRouter — key saved, credentials on disk, the whole
   * tier grid pointing at it — was shown a screen that said, in effect, "no
   * model configured", so they entered the key again. Each re-entry saved a NEW
   * credential: one profile had accumulated 13 copies of the same key against a
   * single provider.
   *
   * The data was never missing. Three separate places had it — the provider
   * store here, `tierModels` in settings, and the credentials on the server —
   * and the step consulted none of them.
   */
  const existingProviders = useProviderStore((s) => s.providers);
  const alreadyConfigured = useMemo(
    () => new Set(existingProviders.map((p) => p.presetId)),
    [existingProviders],
  );

  // Open on what they already use, not on the catalogue's first entry.
  const [presetId, setPresetId] = useState<string>(
    () => useProviderStore.getState().providers[0]?.presetId ?? "anthropic",
  );
  const [fields, setFields] = useState<Partial<Record<CredentialField, string>>>(() => {
    const p = getPreset(useProviderStore.getState().providers[0]?.presetId ?? "anthropic");
    return p?.defaultBaseUrl ? { baseUrl: p.defaultBaseUrl } : {};
  });
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<string | null>(null);

  const setAnthropicApiKey = useSettingsStore((s) => s.setAnthropicApiKey);
  const addProvider = useProviderStore((s) => s.addProvider);
  const setHasCredentials = useProviderStore((s) => s.setHasCredentials);

  const preset = useMemo(() => getPreset(presetId), [presetId]);
  const hint = preset ? providerHint(preset) : null;

  function choose(id: string) {
    setPresetId(id);
    // Clear rather than carry over: a key typed for one provider must never be
    // submitted to another. The base URL is seeded from the preset so the
    // default is visible and editable rather than merely implied.
    const next = getPreset(id);
    setFields(next?.defaultBaseUrl ? { baseUrl: next.defaultBaseUrl } : {});
    setError(null);
  }

  const configure = async () => {
    if (!preset) return;
    setBusy(true);
    setError(null);
    try {
      const planned = planProviderSetup({
        presetId,
        fields,
        existingProviders: useProviderStore.getState().providers,
      });
      if (!planned.ok) {
        setError(planned.error);
        return;
      }
      const { plan } = planned;
      const models = await executeProviderSetup(plan, { scan, saveCredentials });

      // The built-in path also lives in the settings store, which is how the
      // client knows the Claude models are reachable at all.
      if (plan.mirrorToSettings && plan.values.apiKey) setAnthropicApiKey(plan.values.apiKey);

      addProvider({
        id: plan.id,
        presetId: plan.presetId,
        label: plan.label,
        baseUrl: plan.baseUrl,
        enabled: true,
        models,
      });
      if (plan.values.apiKey) setHasCredentials(plan.id, true);
      setConfigured(presetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>

      <h2 className="text-lg font-semibold">How should AIME reach a model?</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Pick one to start — you can add more later in Settings → API Access.
      </p>

      {/*
        Stated before the form, because the form is what misled: a screen asking
        for a key reads as "no key is set", and the honest answer here is usually
        that one already is.
      */}
      {alreadyConfigured.size > 0 && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            {existingProviders.length === 1
              ? `${existingProviders[0].label} is already set up`
              : `${existingProviders.length} providers are already set up`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Nothing to re-enter — continue, or add another below.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {RECOMMENDED_PATHS.map(({ presetId: id, icon: Icon, blurb }) => (
          <button
            key={id}
            onClick={() => choose(id)}
            className={`flex w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-all ${
              presetId === id
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:border-border/80 hover:bg-accent/30"
            }`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {getPreset(id)?.label ?? id}
                {(configured === id || alreadyConfigured.has(id)) && (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                )}
              </span>
              <span className="block text-xs text-muted-foreground">{blurb}</span>
            </span>
          </button>
        ))}

        {!showAll ? (
          <button
            onClick={() => setShowAll(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground"
          >
            <MoreHorizontal className="h-3.5 w-3.5 shrink-0" />
            Other providers — Bedrock, Vertex, OpenAI, Gemini, Groq, Azure, Fal, custom
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {otherPresetIds().map((id) => (
              <button
                key={id}
                onClick={() => choose(id)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                  presetId === id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-border/80 hover:bg-accent/30"
                }`}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  {getPreset(id)?.label ?? id}
                  {configured === id && <Check className="h-3 w-3 text-emerald-500" />}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <div className="grid grid-cols-[110px_1fr] items-center gap-2">
          {preset && (
            <ProviderFields
              preset={preset}
              values={fields}
              disabled={busy}
              onChange={(f, v) => setFields((prev) => ({ ...prev, [f]: v }))}
            />
          )}
          {/* Presets that take neither a base URL field nor a derived one still
              accept an override; Azure derives its endpoint and has none. */}
          {preset && !preset.credentialFields.includes("baseUrl") && preset.id !== "azure-openai" && preset.defaultBaseUrl && (
            <>
              <label className="text-xs text-muted-foreground">Base URL</label>
              <Input
                value={fields.baseUrl ?? ""}
                onChange={(e) => setFields((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder={preset.defaultBaseUrl}
                className="h-8 font-mono text-xs"
                disabled={busy}
              />
            </>
          )}
        </div>

        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        {configured === presetId && !error && (
          // The only success signal used to be a small check beside the path
          // title and the button below changing label, both easy to miss — which
          // reads as "I entered my key and nothing happened".
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            Saved and verified — press Continue below.
          </p>
        )}

        <Button onClick={() => void configure()} disabled={busy} className="w-full">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {configured === presetId ? "Reconfigure" : preset?.scan ? "Save & verify" : "Save"}
        </Button>
      </div>

      <Button variant={configured ? "default" : "ghost"} onClick={onContinue} className="mt-3 w-full">
        {configured ? "Continue" : "Skip — set up later"}
      </Button>
    </div>
  );
}
