"use client";

import { useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useProviderStore } from "@/stores/provider-store";
import { getPreset } from "@/lib/models/providers";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, KeyRound, Globe, HardDrive, Loader2 } from "lucide-react";

/**
 * Onboarding — choose how AIME reaches a model (the P2 provider-path rework).
 *
 * The only inference-setup step in onboarding — it replaced the nib-era "pick
 * your team" step outright (org/team selection lives in a separate product now).
 * Three first-class paths, each wired to the real machinery rather than a fake
 * form:
 *
 *  - Anthropic BYOK  → settings key + keychain mirror (so unattended runs work)
 *  - OpenRouter      → provider added + models scanned + key in the keychain;
 *                      one key reaches most hosted non-Claude models
 *  - Local (Ollama)  → keyless provider, models scanned from the local server
 *
 * Every path is skippable — the app boots without a provider; it just can't
 * run models until one is added in Settings → API Access.
 */

type Path = "anthropic" | "openrouter" | "local";

interface StepProvidersProps {
  onContinue: () => void;
  onBack: () => void;
}

async function saveCredential(providerId: string, apiKey: string): Promise<void> {
  await fetch("/api/models/providers/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, values: { apiKey } }),
  });
}

async function scan(presetId: string, apiKey?: string, baseUrl?: string) {
  const res = await fetch("/api/models/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presetId, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Scan failed (${res.status})`);
  return (data.models ?? []) as import("@/lib/models/providers").ScannedModel[];
}

const PATHS: Array<{ id: Path; icon: typeof KeyRound; title: string; blurb: string }> = [
  {
    id: "anthropic",
    icon: KeyRound,
    title: "Anthropic API key",
    blurb: "Claude direct — the simplest path. Get a key at console.anthropic.com.",
  },
  {
    id: "openrouter",
    icon: Globe,
    title: "OpenRouter",
    blurb: "One key, hundreds of models (Claude, GPT, Kimi, Gemini…). openrouter.ai/keys.",
  },
  {
    id: "local",
    icon: HardDrive,
    title: "Local (Ollama / LM Studio)",
    blurb: "No key, no cloud — models running on this machine.",
  },
];

export function StepProviders({ onContinue, onBack }: StepProvidersProps) {
  const [path, setPath] = useState<Path>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<Path | null>(null);

  const setAnthropicApiKey = useSettingsStore((s) => s.setAnthropicApiKey);
  const addProvider = useProviderStore((s) => s.addProvider);
  const setHasCredentials = useProviderStore((s) => s.setHasCredentials);

  const configure = async () => {
    setBusy(true);
    setError(null);
    try {
      if (path === "anthropic") {
        const key = apiKey.trim();
        if (!key) return;
        setAnthropicApiKey(key);
        // Mirror to the keychain so scheduled (server-side) runs have it too.
        await saveCredential("anthropic", key).catch(() => {});
        setConfigured("anthropic");
      } else if (path === "openrouter") {
        const key = apiKey.trim();
        if (!key) return;
        // Scan first — fail fast on a bad key before persisting anything.
        const models = await scan("openrouter", key);
        const id = globalThis.crypto.randomUUID();
        await saveCredential(id, key);
        addProvider({
          id,
          presetId: "openrouter",
          label: "OpenRouter",
          enabled: true,
          models,
        });
        setHasCredentials(id, true);
        setConfigured("openrouter");
      } else {
        const url = baseUrl.trim() || getPreset("local")?.defaultBaseUrl || "";
        const models = await scan("local", undefined, url);
        addProvider({
          id: globalThis.crypto.randomUUID(),
          presetId: "local",
          label: "Local (Ollama)",
          baseUrl: url,
          enabled: true,
          models,
        });
        setConfigured("local");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  const needsKey = path !== "local";
  const canConfigure = needsKey ? apiKey.trim().length > 0 : true;

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

      <div className="space-y-2">
        {PATHS.map(({ id, icon: Icon, title, blurb }) => (
          <button
            key={id}
            onClick={() => {
              setPath(id);
              setError(null);
            }}
            className={`flex w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-all ${
              path === id
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:border-border/80 hover:bg-accent/30"
            }`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {title}
                {configured === id && <Check className="h-3.5 w-3.5 text-emerald-500" />}
              </span>
              <span className="block text-xs text-muted-foreground">{blurb}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {needsKey ? (
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={path === "anthropic" ? "sk-ant-..." : "sk-or-..."}
            className="font-mono text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canConfigure && !busy) void configure();
            }}
          />
        ) : (
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            className="font-mono text-sm"
          />
        )}
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        {configured === path && !error && (
          // The only success signal used to be a small check beside the path
          // title and the button below changing label from "Skip" to "Continue".
          // Both are easy to miss, which reads as "I entered my key and nothing
          // happened" — so say it, and say what to do next.
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            Saved and verified — press Continue below.
          </p>
        )}
        <Button
          onClick={() => void configure()}
          disabled={!canConfigure || busy}
          className="w-full"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {path === "local" ? "Connect & scan models" : configured === path ? "Reconfigure" : "Save & verify"}
        </Button>
      </div>

      <Button
        variant={configured ? "default" : "ghost"}
        onClick={onContinue}
        className="mt-3 w-full"
      >
        {configured ? "Continue" : "Skip — set up later"}
      </Button>
    </div>
  );
}
