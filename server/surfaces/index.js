import { getChatConfig } from './chat-config.js';
import { getCoworkConfig } from './cowork-config.js';
import { getCodeConfig } from './code-config.js';
import { getBrowserConfig } from './browser-config.js';

const surfaceConfigs = {
  chat: getChatConfig,
  cowork: getCoworkConfig,
  code: getCodeConfig,
  browser: getBrowserConfig,
};

export function getSurfaceConfig(surfaceName, overrides = {}) {
  const getter = surfaceConfigs[surfaceName?.toLowerCase()];
  if (!getter) {
    throw new Error(`Unknown surface: ${surfaceName}. Available: ${Object.keys(surfaceConfigs).join(', ')}`);
  }
  return getter(overrides);
}

export function getAvailableSurfaces() {
  return Object.keys(surfaceConfigs);
}

export { getChatConfig, getCoworkConfig, getCodeConfig, getBrowserConfig };
