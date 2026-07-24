/**
 * Capability calls (image / mesh3d / embedding) — one-shot requests made
 * OUTSIDE the agent loop, via each provider's native API. Unlike agent models
 * these never touch the Agent SDK or the translation shim: any provider works
 * directly. `voice` (local Whisper) and `search` (MCP) are already covered.
 *
 * Executors are transport-dispatched and take an injectable `fetchImpl` so the
 * normalization is unit-testable without network access.
 */
import type { Transport } from './providers';

export type CapabilityKind = 'image' | 'mesh3d' | 'embedding';

export class CapabilityError extends Error {
  constructor(
    message: string,
    public readonly code: 'unsupported' | 'no-key' | 'http' | 'parse',
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'CapabilityError';
  }
}

export interface CapabilityCall {
  capability: CapabilityKind;
  transport: Transport;
  /** The provider's driver/model id (e.g. `fal-ai/flux/dev`, `dall-e-3`). */
  model: string;
  baseUrl?: string;
  apiKey?: string;
  /** image: the text prompt. mesh3d: text or image URL. */
  prompt?: string;
  /** embedding: text(s) to embed. */
  input?: string | string[];
  /** image extras. */
  size?: string;
  n?: number;
}

export interface ImageResult {
  capability: 'image';
  images: Array<{ url?: string; b64?: string }>;
}
export interface MeshResult {
  capability: 'mesh3d';
  mesh: { url: string; format?: string };
}
export interface EmbeddingResult {
  capability: 'embedding';
  model: string;
  embeddings: number[][];
}
export type CapabilityResult = ImageResult | MeshResult | EmbeddingResult;

type FetchImpl = typeof fetch;

function trimBase(url: string): string {
  return url.replace(/\/$/, '');
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new CapabilityError(
      `Upstream ${res.status}: ${detail.slice(0, 300)}`,
      'http',
      res.status === 401 || res.status === 403 ? res.status : 502,
    );
  }
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new CapabilityError('Upstream returned invalid JSON', 'parse');
  }
}

// ── FAL (native-fal) ───────────────────────────────────────────────────────

/** Pull the first mesh/image asset URL out of a heterogeneous FAL payload. */
function falAssetUrl(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = data[k] as { url?: string } | undefined;
    if (v?.url) return v.url;
  }
  return undefined;
}

async function callFal(call: CapabilityCall, fetchImpl: FetchImpl): Promise<CapabilityResult> {
  if (!call.apiKey) throw new CapabilityError('FAL requires an API key', 'no-key', 400);
  const base = trimBase(call.baseUrl || 'https://fal.run');
  const res = await fetchImpl(`${base}/${call.model}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Key ${call.apiKey}` },
    body: JSON.stringify(
      call.capability === 'mesh3d'
        ? { image_url: call.prompt, prompt: call.prompt }
        : { prompt: call.prompt },
    ),
  });
  const data = await readJson(res);

  if (call.capability === 'mesh3d') {
    const url = falAssetUrl(data, ['model_mesh', 'model_glb', 'mesh', 'glb']);
    if (!url) throw new CapabilityError('FAL mesh response had no model URL', 'parse');
    return { capability: 'mesh3d', mesh: { url, format: url.split('.').pop() } };
  }
  const images = (data.images as Array<{ url?: string }> | undefined) ?? [];
  return { capability: 'image', images: images.map((i) => ({ url: i.url })) };
}

// ── OpenAI-compatible (openai-compat) ──────────────────────────────────────

async function callOpenAIImage(call: CapabilityCall, fetchImpl: FetchImpl): Promise<ImageResult> {
  if (!call.baseUrl) throw new CapabilityError('OpenAI-compat image needs a base URL', 'unsupported', 400);
  const res = await fetchImpl(`${trimBase(call.baseUrl)}/images/generations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(call.apiKey ? { authorization: `Bearer ${call.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: call.model, prompt: call.prompt, size: call.size, n: call.n ?? 1 }),
  });
  const data = await readJson(res);
  const arr = (data.data as Array<{ url?: string; b64_json?: string }> | undefined) ?? [];
  return { capability: 'image', images: arr.map((d) => ({ url: d.url, b64: d.b64_json })) };
}

async function callOpenAIEmbedding(call: CapabilityCall, fetchImpl: FetchImpl): Promise<EmbeddingResult> {
  if (!call.baseUrl) throw new CapabilityError('OpenAI-compat embedding needs a base URL', 'unsupported', 400);
  const res = await fetchImpl(`${trimBase(call.baseUrl)}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(call.apiKey ? { authorization: `Bearer ${call.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: call.model, input: call.input }),
  });
  const data = await readJson(res);
  const arr = (data.data as Array<{ embedding: number[]; index: number }> | undefined) ?? [];
  const embeddings = arr
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
  return { capability: 'embedding', model: call.model, embeddings };
}

/**
 * Execute a capability call against its provider. Dispatches on
 * (transport, capability); throws `CapabilityError` for unsupported combos.
 */
export async function runCapability(
  call: CapabilityCall,
  fetchImpl: FetchImpl = fetch,
): Promise<CapabilityResult> {
  if (call.transport === 'native-fal') {
    if (call.capability === 'embedding') {
      throw new CapabilityError('FAL does not serve embeddings', 'unsupported', 400);
    }
    return callFal(call, fetchImpl);
  }

  if (call.transport === 'openai-compat') {
    if (call.capability === 'image') return callOpenAIImage(call, fetchImpl);
    if (call.capability === 'embedding') return callOpenAIEmbedding(call, fetchImpl);
    throw new CapabilityError('OpenAI-compat does not serve mesh3d', 'unsupported', 400);
  }

  // anthropic-native providers are agent-loop models, not capability endpoints.
  throw new CapabilityError(`${call.transport} cannot serve ${call.capability}`, 'unsupported', 400);
}
