"use client";

import { useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProviderStore } from "@/stores/provider-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  buildModelOptions,
  groupOptions,
  findOption,
  isTierOption,
  type BuiltinModel,
  type ConfiguredProviderLite,
  type ModelOption,
} from "@/lib/models/client-options";
import type { TierAssignments } from "@/lib/models/effective-registry";

const BUILTINS: BuiltinModel[] = [
  { id: "opus", label: "Opus 4.7" },
  { id: "sonnet", label: "Sonnet 4.6" },
  { id: "haiku", label: "Haiku 4.5" },
];

/**
 * The option set the picker offers. `rich` mirrors "an `onSelectModel` handler
 * was given": tiers + built-ins + the referenced provider models (a
 * tier-assigned one, plus the current selection so a pinned model never
 * vanishes from its own dropdown). Legacy callers get built-ins only.
 *
 * Exported so the argument choice is directly testable — the dropdown is
 * portalled, so it cannot be opened in jsdom.
 */
export function buildSelectorOptions(
  providers: ConfiguredProviderLite[],
  tierModels: TierAssignments | undefined,
  value: string,
  rich: boolean,
): ModelOption[] {
  if (!rich) return buildModelOptions(BUILTINS, [], { includeTiers: false });
  return buildModelOptions(BUILTINS, providers, {
    tierModels,
    includeModelIds: value ? [value] : [],
  });
}

/**
 * Where a selected value is reported. A tier route and a provider model both
 * carry ids that are NOT valid built-in enum values, so they never go through
 * `onChange` — only `onSelectModel`. A plain built-in sets the enum (and, via
 * the store's `setModel`, clears any existing route).
 *
 * `opt` is undefined when the value isn't in the option list (shouldn't happen —
 * the select only emits item values); a tier id must still never leak.
 *
 * Exported for tests, for the same reason as `buildSelectorOptions`.
 */
export function dispatchSelection(
  opt: ModelOption | undefined,
  value: string,
  handlers: { onChange: (v: string) => void; onSelectModel?: (opt: ModelOption) => void },
): void {
  if (!opt) {
    if (!isTierOption(value)) handlers.onChange(value);
    return;
  }
  if (opt.kind === "model" && !opt.providerConfig) handlers.onChange(value);
  handlers.onSelectModel?.(opt);
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Richer callback carrying the full selected option — a tier route, or a
   * pinned model (incl. `providerConfig` for user-added-provider models). When
   * provided, the selector also offers the automatic tier routes and the user's
   * enabled provider models; otherwise it shows built-ins only, preserving the
   * original behaviour for surfaces not yet wired for it.
   */
  onSelectModel?: (opt: ModelOption) => void;
  className?: string;
}

export function ModelSelector({ value, onChange, onSelectModel, className }: ModelSelectorProps) {
  const providers = useProviderStore((s) => s.providers);
  const tierModels = useSettingsStore((s) => s.tierModels);

  // provider-store hydrates lazily (skipHydration); pull it in once so enabled
  // provider models are available to select.
  useEffect(() => {
    if (onSelectModel) void useProviderStore.persist.rehydrate();
  }, [onSelectModel]);

  const options = useMemo(
    () => buildSelectorOptions(providers, tierModels, value, !!onSelectModel),
    [providers, tierModels, value, onSelectModel],
  );
  const groups = useMemo(() => groupOptions(options), [options]);

  const handleChange = (v: string | null) => {
    if (!v) return;
    dispatchSelection(findOption(options, v), v, { onChange, onSelectModel });
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className={`h-7 w-[130px] text-xs bg-card ${className}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.length <= 1
          ? options.map((o) => (
              <SelectItem key={o.id} value={o.id} className="text-xs">
                {o.label}
              </SelectItem>
            ))
          : groups.map((g) => (
              <SelectGroup key={g.group}>
                <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {g.group}
                </SelectLabel>
                {g.items.map((o) => (
                  <SelectItem key={o.id} value={o.id} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
      </SelectContent>
    </Select>
  );
}
