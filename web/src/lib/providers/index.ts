import { ClaudeProvider } from './claude-provider';
import { BaseProvider, type ProviderConfig } from './base-provider';

// Extend globalThis for singleton caching to survive Next.js hot reload
declare global {
  // eslint-disable-next-line no-var
  var __providerRegistry: Record<string, typeof BaseProvider> | undefined;
  // eslint-disable-next-line no-var
  var __providerInstances: Map<string, BaseProvider> | undefined;
}

// Provider registry - cached on globalThis for hot reload survival.
// Claude (Agent SDK) is the only execution engine; the multi-provider
// model registry is a roadmap pillar (see .planning/aime-roadmap.md).
function getRegistry(): Record<string, typeof BaseProvider> {
  if (!globalThis.__providerRegistry) {
    globalThis.__providerRegistry = {
      claude: ClaudeProvider as unknown as typeof BaseProvider,
    };
  }
  return globalThis.__providerRegistry;
}

// Provider instance cache - cached on globalThis for hot reload survival
function getInstanceCache(): Map<string, BaseProvider> {
  if (!globalThis.__providerInstances) {
    globalThis.__providerInstances = new Map();
  }
  return globalThis.__providerInstances;
}

/**
 * Get a provider instance by name.
 * Instances are cached and reused (survives Next.js hot reload via globalThis).
 */
export function getProvider(providerName: string, config: ProviderConfig = {}): BaseProvider {
  const name = providerName?.toLowerCase() || 'claude';
  const registry = getRegistry();

  if (!registry[name]) {
    throw new Error(`Unknown provider: ${name}. Available providers: ${Object.keys(registry).join(', ')}`);
  }

  // Check cache
  const instanceCache = getInstanceCache();
  const cacheKey = `${name}:${JSON.stringify(config)}`;
  if (instanceCache.has(cacheKey)) {
    return instanceCache.get(cacheKey)!;
  }

  // Create new instance
  const ProviderClass = registry[name] as unknown as new (config: ProviderConfig) => BaseProvider;
  const instance = new ProviderClass(config);
  instanceCache.set(cacheKey, instance);

  return instance;
}

/**
 * Get list of available provider names.
 */
export function getAvailableProviders(): string[] {
  return Object.keys(getRegistry());
}

/**
 * Register a custom provider.
 */
export function registerProvider(name: string, ProviderClass: typeof BaseProvider): void {
  getRegistry()[name.toLowerCase()] = ProviderClass;
}

/**
 * Clear provider instance cache.
 */
export async function clearProviderCache(): Promise<void> {
  const instanceCache = getInstanceCache();
  for (const instance of instanceCache.values()) {
    if (instance.cleanup) {
      await instance.cleanup();
    }
  }
  instanceCache.clear();
}

// Re-export classes and types for direct use
export { ClaudeProvider } from './claude-provider';
export { BaseProvider } from './base-provider';
export type { ProviderConfig, QueryParams, StreamChunk, ChunkType } from './base-provider';
