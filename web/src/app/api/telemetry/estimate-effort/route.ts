import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const NIB_GATEWAY_BASE_URL = 'https://ai-studio.internal.invalid';

/**
 * Heuristic effort estimation when no LLM is available.
 * Uses tool call patterns and artifact counts to approximate complexity.
 */
function estimateLocally(
  toolCalls: Array<{ name: string; count: number }>,
  artifactCount: number,
  messageCount: number,
  durationMs: number,
): Record<string, unknown> {
  const totalTools = toolCalls.reduce((sum, t) => sum + t.count, 0);
  const hasCode = toolCalls.some(t => ['Write', 'Edit', 'Bash'].includes(t.name));
  const hasResearch = toolCalls.some(t => ['Grep', 'Glob', 'Read', 'WebSearch', 'WebFetch'].includes(t.name));

  // Base hours from artifact count and tool usage
  let hours = 0.25; // minimum
  hours += artifactCount * 0.5;
  hours += totalTools * 0.02;
  hours += messageCount * 0.1;

  const complexity = hours > 4 ? 'high' : hours > 1.5 ? 'medium' : 'low';
  const taskType = hasCode
    ? (artifactCount > 3 ? 'feature-development' : 'bug-fix')
    : hasResearch ? 'research' : 'writing';

  return {
    estimatedHours: Math.round(hours * 10) / 10,
    complexity,
    reasoning: `Heuristic estimate based on ${totalTools} tool calls and ${artifactCount} artifacts (${Math.round(durationMs / 60000)}min agent time).`,
    taskType,
    domain: hasCode ? 'fullstack' : 'other',
    language: 'unknown',
  };
}

/**
 * POST /api/telemetry/estimate-effort
 * Calls Claude Haiku to estimate human effort and classify the task type.
 * Routes through nib gateway if apiKey provided, direct API if ANTHROPIC_API_KEY set,
 * otherwise falls back to a local heuristic.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    toolCalls = [],
    artifactCount = 0,
    messageCount = 0,
    durationMs = 0,
    model = 'claude-sonnet-4-6',
    apiKey = null,
  } = body as {
    toolCalls?: Array<{ name: string; count: number }>;
    artifactCount?: number;
    messageCount?: number;
    durationMs?: number;
    model?: string;
    apiKey?: string | null;
  };

  // Determine which backend to use: gateway > direct API > local heuristic
  const useGateway = !!apiKey && apiKey.startsWith('sk-');
  const effectiveKey = apiKey || process.env.ANTHROPIC_API_KEY;

  // No LLM available — use local heuristic
  if (!effectiveKey) {
    const estimate = estimateLocally(toolCalls as Array<{ name: string; count: number }>, artifactCount, messageCount, durationMs);
    return Response.json({ estimate, method: 'heuristic' });
  }

  try {
    const client = useGateway
      ? new Anthropic({ apiKey: effectiveKey, baseURL: NIB_GATEWAY_BASE_URL })
      : new Anthropic({ apiKey: effectiveKey });

    // Gateway uses 'fast' alias for Haiku; direct API uses full model ID
    const haikuModel = useGateway ? 'fast' : 'claude-haiku-4-5-20251001';

    const toolSummary = (toolCalls as Array<{ name: string; count: number }>).map(t => `${t.name}: ${t.count}`).join(', ') || 'none';
    const durationMin = Math.round(durationMs / 60000);

    const prompt = `You are a software engineering effort estimator. Analyze this AI agent session and estimate how long a skilled developer would take to do the equivalent work manually.

Session data:
- Tool calls: ${toolSummary}
- Files created/edited: ${artifactCount}
- Total messages: ${messageCount}
- Agent wall-clock time: ${durationMin} minutes
- Model: ${model}

Return a JSON object with these exact fields:
{
  "estimatedHours": <number, e.g. 2.5>,
  "complexity": "<low|medium|high>",
  "reasoning": "<1-2 sentence explanation>",
  "taskType": "<one of: feature-development, bug-fix, refactor, research, devops, writing, data-analysis>",
  "domain": "<one of: frontend, backend, infrastructure, data, fullstack, other>",
  "language": "<primary programming language detected, or 'unknown'>"
}

Return ONLY valid JSON, no markdown fences.`;

    const response = await client.messages.create({
      model: haikuModel,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
    const estimate = JSON.parse(text);

    return Response.json({ estimate, method: 'llm' });
  } catch (error: unknown) {
    // LLM call failed — fall back to heuristic
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[TELEMETRY] Effort estimation LLM error, using heuristic:', errMsg);
    const estimate = estimateLocally(toolCalls as Array<{ name: string; count: number }>, artifactCount, messageCount, durationMs);
    return Response.json({ estimate, method: 'heuristic' });
  }
}
