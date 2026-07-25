/**
 * Client-side model-picker options: merge the built-in Claude tiers with the
 * models the user scanned+enabled on their added providers, and carry — for
 * each option — exactly what the chat request must send. Pure and browser-safe
 * (only types + the preset catalog), so it is unit-testable.
 */
import { getPreset } from './providers';
import type { ProviderExecConfig } from './execution';

export const BUILTIN_GROUP = 'Built-in (Claude)';

export interface ModelOption {
  /** Unique select value: a built-in id, or `${providerId}:${modelId}`. */
  id: string;
  label: string;
  /** Display group heading. */
  group: string;
  /** The model id/driver name to send as the request `model`. */
  model: string;
  /** Present only for user-added-provider models; absent for built-ins. */
  providerConfig?: ProviderExecConfig;
}

export interface BuiltinModel {
  id: string;
  label: string;
  /** Driver model name; falls back to `id` (the SDK short name). */
  driverModel?: string;
}

/** The slice of a configured provider this builder needs (store-shape subset). */
export interface ConfiguredProviderLite {
  id: string;
  presetId: string;
  label: string;
  baseUrl?: string;
  enabled: boolean;
  models: Array<{ id: string; label?: string }>;
}

/**
 * Build the flat, grouped option list. Built-ins first (each routes via the
 * existing `model` enum, no providerConfig), then one group per *enabled*
 * user provider. A user model carries a `providerConfig` resolved from its
 * preset transport + effective base URL so the server can execute it.
 */
export function buildModelOptions(
  builtins: BuiltinModel[],
  providers: ConfiguredProviderLite[],
): ModelOption[] {
  const out: ModelOption[] = builtins.map((b) => ({
    id: b.id,
    label: b.label,
    group: BUILTIN_GROUP,
    model: b.driverModel ?? b.id,
  }));

  for (const p of providers) {
    if (!p.enabled) continue;
    const preset = getPreset(p.presetId);
    const transport = preset?.transport;
    const baseUrl = p.baseUrl ?? preset?.defaultBaseUrl;
    for (const m of p.models) {
      out.push({
        id: `${p.id}:${m.id}`,
        label: m.label || m.id,
        group: p.label,
        model: m.id,
        providerConfig: { providerId: p.id, transport, baseUrl },
      });
    }
  }

  return out;
}

/** Look an option up by its select value. */
export function findOption(options: ModelOption[], id: string): ModelOption | undefined {
  return options.find((o) => o.id === id);
}

/** Options grouped by heading, preserving insertion order, for rendering. */
export function groupOptions(options: ModelOption[]): Array<{ group: string; items: ModelOption[] }> {
  const groups: Array<{ group: string; items: ModelOption[] }> = [];
  for (const opt of options) {
    let g = groups.find((x) => x.group === opt.group);
    if (!g) {
      g = { group: opt.group, items: [] };
      groups.push(g);
    }
    g.items.push(opt);
  }
  return groups;
}
