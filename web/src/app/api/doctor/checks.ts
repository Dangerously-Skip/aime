/**
 * The doctor's judgements, separated from the I/O that feeds them so each one is
 * testable with the inputs that used to fool it.
 *
 * The model-access check looked at exactly one thing — `ANTHROPIC_API_KEY` in
 * the server's environment — and so told every user who had set up a key in
 * Settings, or an OpenRouter or local provider, that they had no model access.
 * It also passed Bedrock on `AWS_REGION` alone, which is half a configuration.
 */
import * as path from 'path';
import { isProviderCredentialId } from '@/lib/models/credential-ids';

export interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

/** A configured provider as the client reports it. Ids and labels only — never a secret. */
export interface ClientProviderSummary {
  id: string;
  presetId: string;
  label: string;
  enabled: boolean;
  modelCount: number;
  hasCredentials: boolean;
}

const MAX_PROVIDERS = 50;
const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;

/**
 * Validate the provider list a client POSTs. Anything malformed is dropped
 * rather than rejected: the doctor is a diagnostic and should still answer.
 */
export function parseProviderSummaries(raw: unknown): ClientProviderSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientProviderSummary[] = [];
  for (const p of raw.slice(0, MAX_PROVIDERS)) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const id = str(r.id, 128);
    const presetId = str(r.presetId, 64);
    const label = str(r.label, 100);
    if (!id || !presetId || !label) continue;
    out.push({
      id,
      presetId,
      label,
      enabled: r.enabled === true,
      modelCount: typeof r.modelCount === 'number' && r.modelCount >= 0 ? Math.floor(r.modelCount) : 0,
      hasCredentials: r.hasCredentials === true,
    });
  }
  return out;
}

export interface ModelAccessInputs {
  /** `ANTHROPIC_API_KEY` in the server environment. */
  envAnthropicKey: boolean;
  bedrock: { region: boolean; credentials: boolean };
  /** The encrypted credential store: whether it can be read, and which ids it holds. */
  store: { status: 'ok' | 'empty' | 'unavailable' | 'unreadable'; ids: string[]; detail?: string };
  /** What the client says is configured; empty when the caller did not send it. */
  providers: ClientProviderSummary[];
}

/** Presets that reach a model with no key at all. */
const KEYLESS_PRESETS = new Set(['local']);

export function modelAccessCheck(i: ModelAccessInputs): HealthCheck {
  const base = { id: 'model_access', label: 'Model access' };
  const storeReadable = i.store.status === 'ok' || i.store.status === 'empty';
  const sources: string[] = [];
  const problems: string[] = [];

  if (i.envAnthropicKey) sources.push('ANTHROPIC_API_KEY in the environment');
  if (storeReadable && i.store.ids.includes('anthropic')) sources.push('Anthropic key saved in Settings');

  if (i.bedrock.region && i.bedrock.credentials) sources.push('AWS Bedrock (environment)');
  else if (i.bedrock.region) {
    problems.push('AWS_REGION is set but no AWS credentials were found, so Bedrock is not usable');
  }

  const enabled = i.providers.filter((p) => p.enabled && p.presetId !== 'anthropic');
  for (const p of enabled) {
    if (KEYLESS_PRESETS.has(p.presetId)) {
      if (p.modelCount > 0) sources.push(`${p.label} (${p.modelCount} model${p.modelCount === 1 ? '' : 's'})`);
      else problems.push(`${p.label} has no models — rescan it in Settings`);
      continue;
    }
    if (!p.hasCredentials) continue;
    // The client's flag is a hint; the store is the truth when it can be read.
    if (storeReadable && !i.store.ids.includes(p.id)) {
      problems.push(`${p.label}'s key is missing from the credential store — add the provider again`);
      continue;
    }
    sources.push(`${p.label} key saved`);
  }

  // Keys stored for providers the client did not tell us about (a GET, or an
  // older client): still real access, so count them rather than warn.
  if (storeReadable && i.providers.length === 0) {
    const n = i.store.ids.filter(isProviderCredentialId).length;
    if (n > 0) sources.push(`${n} provider key${n === 1 ? '' : 's'} saved`);
  }

  if (!storeReadable) {
    problems.push(
      i.store.status === 'unavailable'
        ? 'Saved keys cannot be read: the server has no credential master key (restart the app)'
        : `Saved keys cannot be decrypted${i.store.detail ? ` (${i.store.detail})` : ''}`,
    );
  }

  if (sources.length === 0) {
    return {
      ...base,
      status: 'warn',
      message: ['No model is configured', ...problems].join('. ') + '.',
      fix: 'Open Settings → Models & API keys and add a provider (Anthropic, OpenRouter, a local model, …).',
    };
  }
  return {
    ...base,
    status: problems.length ? 'warn' : 'ok',
    message: [`Available via ${sources.join(', ')}`, ...problems].join('. ') + '.',
    ...(problems.length ? { fix: 'See Settings → Models & API keys.' } : {}),
  };
}

/** Where the desktop app writes its log (see LOG_FILE in main-web.js). */
export function logFileCheck(
  userDataDir: string | undefined,
  exists: (p: string) => boolean,
): HealthCheck {
  const base = { id: 'log_file', label: 'Log file' };
  if (!userDataDir) {
    return { ...base, status: 'ok', message: 'Development server — logs go to the terminal that started it.' };
  }
  const file = path.join(userDataDir, 'logs', 'aime.log');
  return exists(file)
    ? { ...base, status: 'ok', message: file }
    : { ...base, status: 'ok', message: `${file} (not written yet)` };
}

/**
 * Is the Agent SDK's executable where the SDK will look for it?
 *
 * Packaged builds pass it explicitly (`AIME_SDK_CLI_PATH`). Otherwise the SDK
 * resolves a per-platform native package, or — on older SDKs — its own cli.js.
 * A missing one fails every agent turn with an exit code and no explanation.
 */
export function agentSdkCheck(opts: {
  envCliPath?: string;
  nodeModulesDir: string;
  platform: string;
  arch: string;
  exists: (p: string) => boolean;
}): HealthCheck {
  const base = { id: 'agent_sdk', label: 'Agent SDK' };
  if (opts.envCliPath) {
    return opts.exists(opts.envCliPath)
      ? { ...base, status: 'ok', message: `Found at ${opts.envCliPath}` }
      : {
          ...base,
          status: 'error',
          message: `The packaged Agent SDK is missing (${opts.envCliPath})`,
          fix: 'Reinstall the app; antivirus software sometimes quarantines this file.',
        };
  }
  const sdkDir = path.join(opts.nodeModulesDir, '@anthropic-ai');
  const binary = opts.platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = [
    path.join(sdkDir, `claude-agent-sdk-${opts.platform}-${opts.arch}`, binary),
    path.join(sdkDir, 'claude-agent-sdk', 'cli.js'),
  ];
  const found = candidates.find((c) => opts.exists(c));
  return found
    ? { ...base, status: 'ok', message: `Found at ${found}` }
    : {
        ...base,
        status: 'error',
        message: `No Agent SDK executable for ${opts.platform}-${opts.arch}`,
        fix: 'Run npm install in web/ (the platform package is an optional dependency).',
      };
}

/**
 * SOUL.md / USER.md / MEMORY.md are optional personalisation. Missing is the
 * normal state for a new install, so it is reported as information — it used
 * to be a warning, which put a fresh install permanently in "warn".
 */
export function identityFileCheck(id: string, label: string, file: string, exists: boolean): HealthCheck {
  return exists
    ? { id, label, status: 'ok', message: `${label} found at ${file}` }
    : { id, label, status: 'ok', message: `Not set up (optional). Create ${file} to personalise the assistant.` };
}
