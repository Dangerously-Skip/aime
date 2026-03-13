import { isBedrockConfigured } from '@/lib/bedrock-env';

export const runtime = 'nodejs';

/**
 * List available models.
 * GET /api/models
 */
export async function GET() {
  return Response.json({
    models: [
      { id: 'opus', label: 'Opus 4.6' },
      { id: 'sonnet', label: 'Sonnet 4.6' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ],
    default: 'sonnet',
    bedrock: isBedrockConfigured(),
  });
}
