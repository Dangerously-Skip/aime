/**
 * One implementation of "configure a provider", shared by Settings and
 * onboarding.
 *
 * There were two. Settings had a generic add-provider form; onboarding had its
 * own bespoke branch per path (`if anthropic … else if openrouter … else …`).
 * When the Settings form was made field-driven so Bedrock, Vertex and Azure
 * could be configured at all, onboarding kept its three hardcoded paths — one
 * surface wired, the other forgotten, which is precisely how cowork shipped
 * without a `widget_create` handler.
 *
 * Split into a PURE plan and an effectful execute, so every rule (which fields
 * are required, which id gets reused, what the base URL resolves to) is testable
 * without a network or a store.
 */
import {
  azureBaseUrl,
  getPreset,
  CREDENTIAL_FIELD_SPECS,
  type CredentialField,
  type ProviderPreset,
  type ScannedModel,
} from './providers';

/** A provider already in the store, as the planner needs it. */
export interface ExistingProvider {
  id: string;
  presetId: string;
}

export interface ProviderSetupInput {
  presetId: string;
  /** Raw field values as typed. Trimmed and filtered here. */
  fields: Partial<Record<CredentialField, string>>;
  /** Display name; falls back to the preset label. */
  label?: string;
  /** Base-URL override for presets that take one. */
  baseUrl?: string;
  existingProviders: ReadonlyArray<ExistingProvider>;
}

export interface ProviderSetupPlan {
  id: string;
  presetId: string;
  label: string;
  baseUrl?: string;
  /** Every field to store, already trimmed and filtered to the preset. */
  values: Record<string, string>;
  /**
   * Anthropic doubles as the built-in path: the key also belongs in the settings
   * store (so the client knows built-ins are reachable) and under the fixed
   * `anthropic` credential id (so unattended server-side runs can read it).
   */
  mirrorToSettings: boolean;
  /** False when the preset cannot enumerate models — the caller adds them by hand. */
  canScan: boolean;
}

export type PlanResult =
  | { ok: true; plan: ProviderSetupPlan }
  | { ok: false; error: string };

/**
 * The provider id to write: the existing one if this preset is already
 * configured, otherwise a fresh uuid.
 *
 * Onboarding used to mint `crypto.randomUUID()` unconditionally, so every press
 * of "Save & verify" created ANOTHER provider and stored ANOTHER copy of the key
 * in `~/.aime/credentials.enc`. Reusing the id makes a re-run an update — which
 * is what "Reconfigure" has always claimed to do.
 *
 * Matching on preset (not label) is deliberate: these flows offer one provider
 * per preset. A *second* account for the same preset is a Settings job, where
 * ids are managed explicitly.
 */
/**
 * Presets that are one-per-install and use their preset id as their provider id.
 *
 * `anthropic` is already treated as a fixed, reserved credential id everywhere
 * else — the settings mirror writes it, `RESERVED_CREDENTIAL_IDS` protects it
 * from the orphan sweep. Minting a uuid for it as well meant the same key was
 * stored twice, under two ids, which is the duplication this module exists to
 * stop.
 */
const SINGLETON_PRESETS = new Set(['anthropic']);

export function providerIdForPreset(
  presetId: string,
  existing: ReadonlyArray<ExistingProvider>,
): string {
  if (SINGLETON_PRESETS.has(presetId)) return presetId;
  return existing.find((p) => p.presetId === presetId)?.id ?? globalThis.crypto.randomUUID();
}

/** The non-empty values the user typed, restricted to fields this preset declares. */
export function collectFieldValues(
  preset: ProviderPreset,
  fields: Partial<Record<CredentialField, string>>,
): Partial<Record<CredentialField, string>> {
  const out: Partial<Record<CredentialField, string>> = {};
  for (const f of preset.credentialFields) {
    const v = fields[f]?.trim();
    if (v) out[f] = v;
  }
  return out;
}

/**
 * Which declared fields are still blank and genuinely required.
 *
 * Not every declared field is mandatory: Bedrock and Vertex fall back to the
 * machine's ambient AWS/gcloud credentials, so leaving them empty is a real
 * choice rather than an incomplete form. Requiring them would make the guided
 * setup refuse the most common way those two are actually used.
 */
export function missingRequiredFields(
  preset: ProviderPreset,
  values: Partial<Record<CredentialField, string>>,
): CredentialField[] {
  const optional = new Set<CredentialField>(
    preset.agentMode === 'bedrock' || preset.agentMode === 'vertex'
      ? preset.credentialFields
      : ['azureApiVersion'],
  );
  // A field with a working default is not missing. `local` declares `baseUrl`
  // and defaults it to the Ollama port, so demanding it made the guided path
  // refuse a setup that needs no input at all.
  if (preset.defaultBaseUrl) optional.add('baseUrl');
  return preset.credentialFields.filter((f) => !optional.has(f) && !values[f]);
}

/** Validate and resolve everything, without touching the network or a store. */
export function planProviderSetup(input: ProviderSetupInput): PlanResult {
  const preset = getPreset(input.presetId);
  if (!preset) return { ok: false, error: `Unknown provider: ${input.presetId}` };

  const values = collectFieldValues(preset, input.fields);
  const missing = missingRequiredFields(preset, values);
  if (missing.length) {
    return {
      ok: false,
      error: `Fill in: ${missing.map((f) => CREDENTIAL_FIELD_SPECS[f].label).join(', ')}`,
    };
  }

  // Azure routes per deployment, so its endpoint is derived rather than typed.
  const baseUrl =
    azureBaseUrl(values) ?? ((values.baseUrl || input.baseUrl || '').trim() || preset.defaultBaseUrl);

  return {
    ok: true,
    plan: {
      id: providerIdForPreset(input.presetId, input.existingProviders),
      presetId: input.presetId,
      label: (input.label || '').trim() || preset.label,
      baseUrl: baseUrl || undefined,
      values: values as Record<string, string>,
      mirrorToSettings: input.presetId === 'anthropic',
      canScan: !!preset.scan,
    },
  };
}

/** Network calls the executor makes, injected so tests drive the real logic. */
export interface SetupDeps {
  scan: (presetId: string, opts: { apiKey?: string; baseUrl?: string }) => Promise<ScannedModel[]>;
  saveCredentials: (providerId: string, values: Record<string, string>) => Promise<void>;
}

/**
 * Run a plan: discover models, then persist the secrets.
 *
 * Scan FIRST so a bad key fails before anything is written — otherwise a typo
 * leaves a provider in the store and a dead key in the keychain.
 */
export async function executeProviderSetup(
  plan: ProviderSetupPlan,
  deps: SetupDeps,
): Promise<ScannedModel[]> {
  const models = plan.canScan
    ? await deps.scan(plan.presetId, { apiKey: plan.values.apiKey, baseUrl: plan.baseUrl })
    : [];

  // `baseUrl` is not stored: it already lives on the provider config, which is
  // where `execConfigFor` reads it from. Writing it to the credential store as
  // well would give a keyless provider (local/Ollama) a credential record it
  // does not need, and put the same value in two places.
  const toStore = Object.fromEntries(
    Object.entries(plan.values).filter(([k]) => k !== 'baseUrl'),
  );
  if (Object.keys(toStore).length) {
    await deps.saveCredentials(plan.id, toStore);
  }
  // The built-in path reads the key back under a fixed id on the server, so an
  // unattended run can reach Anthropic without the provider store.
  if (plan.mirrorToSettings && plan.values.apiKey && plan.id !== 'anthropic') {
    await deps.saveCredentials('anthropic', { apiKey: plan.values.apiKey }).catch(() => {});
  }
  return models;
}
