import { getChatConfig } from './chat-config';
import { getCoworkConfig } from './cowork-config';
import { getCodeConfig } from './code-config';
import { getBrowserConfig } from './browser-config';

/**
 * Configuration for a surface (chat, cowork, code, browser).
 */
export interface SurfaceConfig {
  allowedTools: string[];
  permissionMode: string;
  systemPrompt: string | { type: string; preset: string; append?: string };
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  includePartialMessages: boolean;
  mcpServers: Record<string, unknown>;
  settingSources?: string[];
  enableFileCheckpointing?: boolean;
}

type SurfaceConfigGetter = (overrides?: Partial<SurfaceConfig>) => SurfaceConfig;

const surfaceConfigs: Record<string, SurfaceConfigGetter> = {
  chat: getChatConfig,
  cowork: getCoworkConfig,
  code: getCodeConfig,
  browser: getBrowserConfig,
};

/**
 * Get the config for a given surface name, with optional overrides.
 */
export function getSurfaceConfig(surfaceName: string, overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  const getter = surfaceConfigs[surfaceName?.toLowerCase()];
  if (!getter) {
    throw new Error(`Unknown surface: ${surfaceName}. Available: ${Object.keys(surfaceConfigs).join(', ')}`);
  }
  return getter(overrides);
}

/**
 * Get list of available surface names.
 */
export function getAvailableSurfaces(): string[] {
  return Object.keys(surfaceConfigs);
}

export { getChatConfig, getCoworkConfig, getCodeConfig, getBrowserConfig };
