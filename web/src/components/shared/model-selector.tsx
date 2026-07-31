"use client";

import { useMemo } from "react";
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
import { useBuiltinAccess } from "@/hooks/use-builtin-access";
import {
  buildModelOptions,
  defaultRoute,
  groupOptions,
  findOption,
  isTierOption,
  TIER_OPTION_PREFIX,
  type BuiltinModel,
  type ConfiguredProviderLite,
  type ModelOption,
} from "@/lib/models/client-options";
import type { ProviderWithModels, TierAssignments } from "@/lib/models/effective-registry";
import type { Capability } from "@/lib/models/types";

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
 * `hasBuiltins` drops the "Built-in (Claude)" group when no Anthropic or Bedrock
 * credential can reach it — offering a model the install cannot run is how a
 * BYOK-only user ended up being asked to log in to Anthropic. Legacy (non-rich)
 * callers keep them regardless: built-ins are their entire dropdown, and an
 * empty select is worse than an aspirational one.
 *
 * Exported so the argument choice is directly testable — the dropdown is
 * portalled, so it cannot be opened in jsdom.
 */
export function buildSelectorOptions(
  providers: ConfiguredProviderLite[],
  tierModels: TierAssignments | undefined,
  value: string,
  rich: boolean,
  hasBuiltins = true,
): ModelOption[] {
  if (!rich) return buildModelOptions(BUILTINS, [], { includeTiers: false });
  // With no built-in credential AND no provider models to fall back on there is
  // nothing reachable at all — and hiding the built-ins then leaves a dropdown of
  // four tiers that resolve to nothing and a blank trigger, which is the state a
  // first-run user who skipped onboarding is in. Showing them is more useful than
  // showing nothing: they are at least the thing to get a key for.
  const anyProviderModels = providers.some((p) => p.enabled && p.models.length > 0);
  const showBuiltins = hasBuiltins || !anyProviderModels;
  return buildModelOptions(showBuiltins ? BUILTINS : [], providers, {
    tierModels,
    includeModelIds: value ? [value] : [],
  });
}

/**
 * What the trigger should read. Normally `value` — but a surface's default is a
 * built-in id ('sonnet'), and when no built-in credential exists that id is
 * neither offered nor sent: `resolveSendRoute` quietly routes the turn through a
 * tier instead. Showing "Sonnet 4.6" over an OpenRouter turn is a lie, so fall
 * back to the tier `defaultRoute` picks — the same function the send path uses,
 * so the two cannot drift.
 *
 * Returns `value` unchanged when it IS a valid option, and when nothing
 * resolves (an empty trigger beats a wrong one).
 */
export function displayValue(
  value: string,
  options: ModelOption[],
  providers: ProviderWithModels[],
  opts: {
    capability: Capability;
    tierModels?: TierAssignments;
    hasAnthropicKey?: boolean;
    hasBedrock?: boolean;
  },
): string {
  if (options.some((o) => o.id === value)) return value;
  const fallback = defaultRoute(providers, opts);
  return fallback ? `${TIER_OPTION_PREFIX}${fallback.tier}` : value;
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
  handlers: { onChange?: (v: string) => void; onSelectModel?: (opt: ModelOption) => void },
): void {
  if (!opt) {
    if (!isTierOption(value)) handlers.onChange?.(value);
    return;
  }
  if (opt.kind === "model" && !opt.providerConfig) handlers.onChange?.(value);
  handlers.onSelectModel?.(opt);
}

interface ModelSelectorProps {
  value: string;
  /**
   * Legacy escape hatch for a built-in enum. Optional because the surfaces now
   * record EVERY selection as a `modelRoute` — one representation, so an
   * unpinned selector genuinely means "whatever Settings resolves to" rather
   * than a hardcoded default the user never chose.
   */
  onChange?: (value: string) => void;
  /**
   * Richer callback carrying the full selected option — a tier route, or a
   * pinned model (incl. `providerConfig` for user-added-provider models). When
   * provided, the selector also offers the automatic tier routes and the user's
   * enabled provider models; otherwise it shows built-ins only, preserving the
   * original behaviour for surfaces not yet wired for it.
   */
  onSelectModel?: (opt: ModelOption) => void;
  /**
   * The surface's capability, used only to resolve what an unpinned selection
   * would route to (see `displayValue`). Defaults to 'chat'.
   */
  capability?: Capability;
  className?: string;
}

export function ModelSelector({
  value,
  onChange,
  onSelectModel,
  capability = "chat",
  className,
}: ModelSelectorProps) {
  const providers = useProviderStore((s) => s.providers);
  const tierModels = useSettingsStore((s) => s.tierModels);
  const { hasAnthropicKey, hasBedrock, hasBuiltins } = useBuiltinAccess();

  // provider-store is rehydrated centrally by StoreHydration, alongside every
  // other persisted store. It used to be pulled in from right here:
  //
  //   useEffect(() => { if (onSelectModel) void useProviderStore.persist.rehydrate(); },
  //            [onSelectModel]);
  //
  // which froze the app. `onSelectModel` is a function prop and every call site
  // passes an inline arrow, so its identity changes on each parent render: the
  // effect re-ran, rehydrate() replaced the providers array, subscribers
  // re-rendered, the prop was recreated, and the effect re-ran — forever, at
  // 100% CPU, rebuilding the option list over every model each cycle. With a
  // 341-model OpenRouter provider configured the renderer never painted again,
  // so the window kept showing its last frame and looked simply unresponsive.
  //
  // A component reaching out to rehydrate a global store was the deeper mistake;
  // the store is now in the central list where it belonged.

  const options = useMemo(
    () => buildSelectorOptions(providers, tierModels, value, !!onSelectModel, hasBuiltins),
    [providers, tierModels, value, onSelectModel, hasBuiltins],
  );
  const groups = useMemo(() => groupOptions(options), [options]);
  const shown = useMemo(
    () =>
      displayValue(value, options, providers, {
        capability,
        tierModels,
        hasAnthropicKey,
        hasBedrock,
      }),
    [value, options, providers, capability, tierModels, hasAnthropicKey, hasBedrock],
  );

  /**
   * The resolved id is for the LABEL only — it must not become Radix's selected
   * value.
   *
   * Passing it as `value` made the option the trigger already displayed
   * unselectable: Radix suppresses `onValueChange` when the picked item equals
   * the current value, so a BYOK-only user seeing "Good — balanced" could not
   * click "Good — balanced" to actually pin it. The selection stays whatever the
   * store holds (empty when that id is not on offer, so every item is a change),
   * and the trigger renders the honest label itself.
   */
  const selected = options.some((o) => o.id === value) ? value : '';
  const shownLabel = findOption(options, shown)?.label ?? '';

  const handleChange = (v: string | null) => {
    if (!v) return;
    dispatchSelection(findOption(options, v), v, { onChange, onSelectModel });
  };

  return (
    <Select value={selected} onValueChange={handleChange}>
      <SelectTrigger className={`h-7 w-[130px] text-xs bg-card ${className}`}>
        {shownLabel ? <span className="truncate">{shownLabel}</span> : <SelectValue />}
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
