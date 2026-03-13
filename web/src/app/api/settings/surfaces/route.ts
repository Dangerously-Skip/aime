import { getAvailableSurfaces, getSurfaceConfig } from '@/lib/surfaces';

export const runtime = 'nodejs';

/**
 * GET /api/settings/surfaces
 * Returns all surface configs (tools, model, maxTurns, budget, permissionMode).
 * System prompts are stripped for security.
 */
export async function GET() {
  const surfaces = getAvailableSurfaces();
  const configs: Record<string, unknown> = {};

  for (const name of surfaces) {
    const config = getSurfaceConfig(name);
    configs[name] = {
      allowedTools: config.allowedTools,
      model: config.model,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      permissionMode: config.permissionMode,
    };
  }

  return Response.json({ surfaces: configs });
}
