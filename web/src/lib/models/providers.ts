/**
 * Provider layer (P1.2 / DR-12).
 *
 * A provider is added by API key. `transport` is the single discriminant that
 * decides how a provider's models execute:
 *   - anthropic-native — env/base-URL; the Agent SDK drives it directly
 *   - openai-compat     — OpenAI-format endpoint; agent calls go via the shim
 *   - native-fal        — bespoke capability API, outside the agent loop
 *
 * The catalog (`PROVIDER_PRESETS`) ships each provider as a template that
 * knows its transport, default base URL, required credential fields,
 * capabilities, and how to list models.
 */
import type { Capability, ModelPricing } from './types';

/** Coarse execution strategy — derived onto the provider, read by the executor. */
export type Transport = 'anthropic-native' | 'openai-compat' | 'native-fal';

/**
 * How the Agent SDK reaches an `anthropic-native` provider for the chat/code
 * loop. `none` = capability-only (not an agent provider).
 */
export type AgentMode = 'api-key' | 'bedrock' | 'vertex' | 'none';

/** A field the user must supply when configuring a provider. */
export type CredentialField =
  | 'apiKey'
  | 'awsRegion'
  | 'awsAccessKeyId'
  | 'awsSecretAccessKey'
  | 'azureResource'
  | 'azureDeployment'
  | 'azureApiVersion'
  | 'vertexProject'
  | 'vertexRegion'
  | 'baseUrl';

/** How to auth the scan request. */
export type ScanAuth = 'bearer' | 'x-api-key' | 'none';

/** How to discover a provider's models. */
export interface ScanDescriptor {
  /** Response shape → picks the normalizer. */
  shape: 'openai' | 'anthropic' | 'openrouter' | 'fal-static';
  /** Path appended to the base URL, e.g. '/models'. Ignored for fal-static. */
  path?: string;
  auth?: ScanAuth;
}

/** A catalog template for a provider. */
export interface ProviderPreset {
  /** Stable catalog id, e.g. 'anthropic', 'openai', 'openrouter'. */
  id: string;
  label: string;
  transport: Transport;
  agentMode: AgentMode;
  /** Preset default base URL; user-overridable. */
  defaultBaseUrl?: string;
  /** Secret + non-secret fields the user must supply. */
  credentialFields: CredentialField[];
  /** Which capabilities this provider can serve. */
  capabilities: Capability[];
  /** Absent = model discovery not supported (enter models manually). */
  scan?: ScanDescriptor;
  /**
   * Aggregators expose many vendors behind one key, but their Anthropic-format
   * endpoint only serves that vendor's own models. Models whose id starts with
   * this prefix can use `transport`; everything else must go through the
   * openai-compat shim. Absent = every model uses `transport`.
   *
   * OpenRouter is the case in point: /api/v1/messages serves `anthropic/*` only,
   * so sending google/gemini-* or moonshotai/kimi-* there is rejected with
   * "issue with the selected model".
   */
  nativeModelPrefix?: string;
  /** True for the free-form "bring any endpoint" escape hatch. */
  custom?: boolean;
}

/**
 * A user-configured provider instance. Secrets live in the credential store
 * (keychain), keyed by `id` — never inline here.
 */
export interface ProviderConfig {
  /** Instance id (uuid, or the preset id for singletons). */
  id: string;
  presetId: string;
  label: string;
  /** Base-URL override; falls back to the preset default. */
  baseUrl?: string;
  /** Non-secret config: region, resource, deployment, etc. */
  settings?: Partial<Record<CredentialField, string>>;
  enabled: boolean;
  createdAt: number;
}

/** A model returned by scanning a provider, before it's slotted into routing. */
export interface ScannedModel {
  id: string;
  label: string;
  capabilities?: Capability[];
  contextWindow?: number;
  pricing?: ModelPricing;
}

// ── Catalog ─────────────────────────────────────────────────────────────

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    transport: 'anthropic-native',
    agentMode: 'api-key',
    defaultBaseUrl: 'https://api.anthropic.com',
    credentialFields: ['apiKey'],
    capabilities: ['chat', 'code'],
    scan: { shape: 'anthropic', path: '/v1/models', auth: 'x-api-key' },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    transport: 'anthropic-native',
    agentMode: 'api-key',
    // OpenRouter's Anthropic-compatible endpoint; also serves the models list.
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    credentialFields: ['apiKey'],
    capabilities: ['chat', 'code'],
    nativeModelPrefix: 'anthropic/',
    scan: { shape: 'openrouter', path: '/models', auth: 'bearer' },
  },
  {
    id: 'bedrock',
    label: 'AWS Bedrock',
    transport: 'anthropic-native',
    agentMode: 'bedrock',
    credentialFields: ['awsRegion', 'awsAccessKeyId', 'awsSecretAccessKey'],
    capabilities: ['chat', 'code'],
    // Bedrock model listing needs the AWS API — deferred; enter models manually.
  },
  {
    id: 'vertex',
    label: 'Google Vertex (Claude)',
    transport: 'anthropic-native',
    agentMode: 'vertex',
    credentialFields: ['vertexProject', 'vertexRegion'],
    capabilities: ['chat', 'code'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    transport: 'openai-compat',
    agentMode: 'api-key',
    defaultBaseUrl: 'https://api.openai.com/v1',
    credentialFields: ['apiKey'],
    capabilities: ['chat', 'code', 'image', 'embedding'],
    scan: { shape: 'openai', path: '/models', auth: 'bearer' },
  },
  {
    id: 'google',
    label: 'Google Gemini',
    transport: 'openai-compat',
    agentMode: 'api-key',
    // Gemini's OpenAI-compatibility endpoint.
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    credentialFields: ['apiKey'],
    capabilities: ['chat', 'code', 'image', 'embedding'],
    scan: { shape: 'openai', path: '/models', auth: 'bearer' },
  },
  {
    id: 'groq',
    label: 'Groq',
    transport: 'openai-compat',
    agentMode: 'api-key',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    credentialFields: ['apiKey'],
    capabilities: ['chat', 'code'],
    scan: { shape: 'openai', path: '/models', auth: 'bearer' },
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    transport: 'openai-compat',
    agentMode: 'api-key',
    credentialFields: ['apiKey', 'azureResource', 'azureDeployment', 'azureApiVersion'],
    capabilities: ['chat', 'code', 'image', 'embedding'],
    // Azure lists models as per-deployment — no generic scan; enter manually.
  },
  {
    id: 'fal',
    label: 'Fal',
    transport: 'native-fal',
    agentMode: 'none',
    defaultBaseUrl: 'https://fal.run',
    credentialFields: ['apiKey'],
    capabilities: ['image', 'mesh3d', 'voice'],
    scan: { shape: 'fal-static' },
  },
  {
    id: 'local',
    label: 'Local (Ollama / LM Studio)',
    transport: 'openai-compat',
    agentMode: 'api-key',
    defaultBaseUrl: 'http://localhost:11434/v1',
    credentialFields: ['baseUrl'],
    capabilities: ['chat', 'code', 'embedding'],
    scan: { shape: 'openai', path: '/models', auth: 'none' },
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    transport: 'openai-compat',
    agentMode: 'api-key',
    credentialFields: ['baseUrl', 'apiKey'],
    capabilities: ['chat', 'code', 'image', 'embedding'],
    scan: { shape: 'openai', path: '/models', auth: 'bearer' },
    custom: true,
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/** Presets that can serve a given capability. */
export function presetsForCapability(capability: Capability): ProviderPreset[] {
  return PROVIDER_PRESETS.filter((p) => p.capabilities.includes(capability));
}

/** True if this provider requires a secret API key to be configured. */
export function needsApiKey(preset: ProviderPreset): boolean {
  return preset.credentialFields.includes('apiKey');
}

/**
 * What to render, and what to say, for each configurable field.
 *
 * Declared once here rather than in the form, because the form is generated
 * FROM `credentialFields` — the previous version hardcoded an API-key input, so
 * Bedrock, Vertex and Azure had inputs for none of the fields they declare and
 * simply could not be configured through the UI at all.
 *
 * `secret: true` decides masking, and nothing more: every field is stored the
 * same way, in the server-side credential store keyed by provider id. Region and
 * project id are not secrets, but they are read back on the server exactly like
 * one, so splitting the storage would buy nothing and add a second path.
 */
export interface CredentialFieldSpec {
  label: string;
  placeholder?: string;
  /** One line under the input: what it is, or where to get it. */
  help?: string;
  secret?: boolean;
}

export const CREDENTIAL_FIELD_SPECS: Record<CredentialField, CredentialFieldSpec> = {
  apiKey: {
    label: 'API key',
    placeholder: 'sk-…',
    help: 'Stored in your OS keychain, never in the browser.',
    secret: true,
  },
  baseUrl: {
    label: 'Base URL',
    placeholder: 'http://localhost:11434/v1',
    help: 'The OpenAI-compatible endpoint to call.',
  },
  awsRegion: {
    label: 'AWS region',
    placeholder: 'us-east-1',
    help: 'The region your Bedrock model access is enabled in.',
  },
  awsAccessKeyId: {
    label: 'AWS access key ID',
    placeholder: 'AKIA…',
    secret: true,
  },
  awsSecretAccessKey: {
    label: 'AWS secret access key',
    placeholder: '••••••••',
    // The "leave blank for ambient credentials" note belongs to the whole AWS
    // group, not to this one field — `providerHint` says it once.
    secret: true,
  },
  vertexProject: {
    label: 'GCP project id',
    placeholder: 'my-project-123',
    help: 'Vertex uses your ambient gcloud credentials for auth.',
  },
  vertexRegion: {
    label: 'Vertex region',
    placeholder: 'us-east5',
    help: 'The region the Claude models are enabled in.',
  },
  azureResource: {
    label: 'Resource name',
    placeholder: 'my-resource',
    help: 'The name in https://<resource>.openai.azure.com.',
  },
  azureDeployment: {
    label: 'Deployment name',
    placeholder: 'gpt-4o',
    help: 'Azure routes by deployment, not by model id.',
  },
  azureApiVersion: {
    label: 'API version',
    placeholder: '2024-10-21',
  },
};

/**
 * Azure exposes one deployment per endpoint, so its base URL is derived from
 * three fields rather than entered. Returns undefined when they are incomplete.
 */
export function azureBaseUrl(values: Partial<Record<CredentialField, string>>): string | undefined {
  const { azureResource, azureDeployment, azureApiVersion } = values;
  if (!azureResource || !azureDeployment) return undefined;
  const version = azureApiVersion || '2024-10-21';
  return `https://${azureResource}.openai.azure.com/openai/deployments/${azureDeployment}?api-version=${version}`;
}
