/**
 * Model discovery (P1.2 / DR-12).
 *
 * Given a provider preset + credentials, call the provider's own list endpoint
 * and normalize the response to `ScannedModel[]`. OpenRouter's list is rich
 * (pricing + context + modality) so we infer capability/tier hints from it;
 * OpenAI-shape lists are sparse (ids only); Fal is a static catalog.
 */
import type { Capability } from './types';
import type { ProviderPreset, ScannedModel, ScanAuth } from './providers';

/** Raised when scanning isn't possible for this provider or the call fails. */
export class ScanError extends Error {
  constructor(message: string, readonly code: 'unsupported' | 'no-key' | 'http' | 'parse') {
    super(message);
    this.name = 'ScanError';
  }
}

export interface ScanOptions {
  apiKey?: string;
  /** Overrides the preset default base URL. */
  baseUrl?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

function authHeaders(auth: ScanAuth, apiKey?: string): Record<string, string> {
  switch (auth) {
    case 'bearer':
      return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    case 'x-api-key':
      return apiKey ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : {};
    case 'none':
    default:
      return {};
  }
}

/** Fixed catalog for Fal (no live list endpoint). */
export const FAL_STATIC_MODELS: ScannedModel[] = [
  { id: 'fal-ai/flux/dev', label: 'FLUX.1 [dev]', capabilities: ['image'] },
  { id: 'fal-ai/flux-pro', label: 'FLUX.1 [pro]', capabilities: ['image'] },
  { id: 'fal-ai/hunyuan3d', label: 'Hunyuan3D', capabilities: ['mesh3d'] },
  { id: 'fal-ai/whisper', label: 'Whisper', capabilities: ['voice'] },
];

interface OpenAIListItem { id: string }
interface AnthropicListItem { id: string; display_name?: string }
interface OpenRouterListItem {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; output_modalities?: string[] };
}

function normalizeOpenAI(json: unknown): ScannedModel[] {
  const data = (json as { data?: OpenAIListItem[] })?.data ?? [];
  return data
    .filter((m) => typeof m?.id === 'string')
    .map((m) => ({ id: m.id, label: m.id }));
}

function normalizeAnthropic(json: unknown): ScannedModel[] {
  const data = (json as { data?: AnthropicListItem[] })?.data ?? [];
  return data
    .filter((m) => typeof m?.id === 'string')
    .map((m) => ({ id: m.id, label: m.display_name ?? m.id, capabilities: ['chat', 'code'] }));
}

/** Infer capabilities from OpenRouter's modality metadata. */
function inferOpenRouterCaps(item: OpenRouterListItem): Capability[] | undefined {
  const outputs = item.architecture?.output_modalities;
  const modality = item.architecture?.modality ?? '';
  const producesImage = outputs?.includes('image') || /->\s*image|image\s*$/.test(modality);
  if (producesImage) return ['image'];
  // Text-out models serve chat + code.
  if (outputs?.includes('text') || modality.includes('text')) return ['chat', 'code'];
  return undefined;
}

/** OpenRouter prices are USD per token as strings — convert to per-1k. */
function perThousand(perToken?: string): number | undefined {
  if (perToken == null) return undefined;
  const n = Number(perToken);
  return Number.isFinite(n) ? n * 1000 : undefined;
}

function normalizeOpenRouter(json: unknown): ScannedModel[] {
  const data = (json as { data?: OpenRouterListItem[] })?.data ?? [];
  return data
    .filter((m) => typeof m?.id === 'string')
    .map((m) => {
      const input = perThousand(m.pricing?.prompt);
      const output = perThousand(m.pricing?.completion);
      return {
        id: m.id,
        label: m.name ?? m.id,
        capabilities: inferOpenRouterCaps(m),
        contextWindow: m.context_length,
        pricing: input != null && output != null
          ? { inputPer1kUsd: input, outputPer1kUsd: output }
          : undefined,
      };
    });
}

/** Discover a provider's models. Throws `ScanError` on unsupported/failed scans. */
export async function scanModels(preset: ProviderPreset, opts: ScanOptions = {}): Promise<ScannedModel[]> {
  const { scan } = preset;
  if (!scan) {
    throw new ScanError(`${preset.label} does not support model discovery`, 'unsupported');
  }
  if (scan.shape === 'fal-static') {
    return FAL_STATIC_MODELS;
  }

  const auth = scan.auth ?? 'bearer';
  if (auth !== 'none' && !opts.apiKey) {
    throw new ScanError(`${preset.label} requires an API key to list models`, 'no-key');
  }

  const base = (opts.baseUrl ?? preset.defaultBaseUrl ?? '').replace(/\/+$/, '');
  const url = `${base}${scan.path ?? ''}`;
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(url, { headers: authHeaders(auth, opts.apiKey) });
  } catch (err) {
    throw new ScanError(`Could not reach ${preset.label}: ${err instanceof Error ? err.message : String(err)}`, 'http');
  }
  if (!res.ok) {
    throw new ScanError(`${preset.label} returned HTTP ${res.status}`, 'http');
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ScanError(`${preset.label} returned a non-JSON model list`, 'parse');
  }

  switch (scan.shape) {
    case 'anthropic': return normalizeAnthropic(json);
    case 'openrouter': return normalizeOpenRouter(json);
    case 'openai':
    default: return normalizeOpenAI(json);
  }
}
