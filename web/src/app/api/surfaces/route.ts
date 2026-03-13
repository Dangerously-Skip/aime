import { getAvailableSurfaces, getSurfaceConfig } from '@/lib/surfaces';
import type { SurfaceConfig } from '@/lib/surfaces';

export const runtime = 'nodejs';

/**
 * List available surfaces and their configs (system prompts stripped for security).
 * GET /api/surfaces
 */
export async function GET() {
  const surfaces = getAvailableSurfaces();
  const configs: Record<string, Omit<SurfaceConfig, 'systemPrompt'>> = {};

  for (const surface of surfaces) {
    const config = getSurfaceConfig(surface);
    // Strip systemPrompt from config for security -- don't expose to client
    const { systemPrompt: _systemPrompt, ...safeConfig } = config;
    configs[surface] = safeConfig;
  }

  return Response.json({ surfaces, configs });
}
