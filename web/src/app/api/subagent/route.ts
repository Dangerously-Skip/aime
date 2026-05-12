import { NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';
import { getSurfaceConfig } from '@/lib/surfaces';
import { loadAgents, readAgentSystemPrompt } from '@/lib/agents-parser';

export const runtime = 'nodejs';

/**
 * POST /api/subagent
 * Spawns an isolated sub-agent run and returns its full text output.
 *
 * Body:
 *   parentChatId - ID of the parent conversation (for correlation)
 *   task         - The task prompt to run
 *   surfaceId    - Which surface config to use (default: cowork)
 *   model        - Optional model override
 *   apiKey       - Optional API key override
 *   cwd          - Optional working directory
 *   agentName    - Optional named agent config to use
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    parentChatId,
    task,
    surfaceId = 'cowork',
    model = null,
    apiKey = null,
    cwd = null,
    agentName = null,
  } = body as {
    parentChatId?: string;
    task?: string;
    surfaceId?: string;
    model?: string | null;
    apiKey?: string | null;
    cwd?: string | null;
    agentName?: string | null;
  };

  if (!task || typeof task !== 'string') {
    return Response.json({ error: 'task is required' }, { status: 400 });
  }

  const subagentId = `subagent_${parentChatId ?? 'anon'}_${Date.now()}`;
  console.log('[SUBAGENT] Spawning sub-agent:', subagentId, '| task:', task.slice(0, 80), agentName ? `| agent: ${agentName}` : '');

  try {
    const provider = getProvider('claude');
    const surfaceConfig = getSurfaceConfig(surfaceId as string);

    // Resolve named agent config if provided
    let agentModel: string | undefined;
    let agentAllowedTools: string[] | undefined;
    let agentSystemPrompt: string | undefined;
    if (agentName) {
      const agents = loadAgents((cwd as string) || undefined);
      const agentConfig = agents.find((a) => a.name === agentName);
      if (agentConfig) {
        agentModel = agentConfig.model;
        // Intersect agent allowedTools with surface defaults if both defined
        if (agentConfig.allowedTools && surfaceConfig.allowedTools) {
          agentAllowedTools = agentConfig.allowedTools.filter((t) =>
            (surfaceConfig.allowedTools as string[]).includes(t)
          );
        } else {
          agentAllowedTools = agentConfig.allowedTools;
        }
        const sp = readAgentSystemPrompt(agentConfig);
        if (sp) agentSystemPrompt = sp;
        console.log('[SUBAGENT] Resolved agent config:', agentName, '| model:', agentModel);
      } else {
        console.warn('[SUBAGENT] Agent not found:', agentName, '— using surface defaults');
      }
    }

    let output = '';
    const canvasDocs: unknown[] = [];
    for await (const chunk of provider.query({
      prompt: task,
      chatId: subagentId,
      userId: `subagent_${parentChatId ?? 'anon'}`,
      mcpServers: {},
      model: (model as string) || agentModel || surfaceConfig.model,
      surfaceId: surfaceId as string,
      allowedTools: agentAllowedTools ?? surfaceConfig.allowedTools,
      maxTurns: Math.min(surfaceConfig.maxTurns ?? 10, 20), // cap sub-agent turns
      systemPrompt: agentSystemPrompt ?? surfaceConfig.systemPrompt,
      apiKey: (apiKey as string) || undefined,
      cwd: (cwd as string) || undefined,
    })) {
      if (chunk.type === 'text') {
        output += (chunk.content as string) || '';
      } else if (chunk.type === 'canvas' && chunk.doc) {
        // Used by the canvas auto-refresh path — the caller wants the
        // resulting A2UIDocument, not just text.
        canvasDocs.push(chunk.doc);
      }
    }

    console.log('[SUBAGENT] Completed:', subagentId, '| output length:', output.length, '| canvas docs:', canvasDocs.length);
    return Response.json({
      ok: true,
      subagentId,
      parentChatId,
      output,
      canvasDocs,
      canvas: canvasDocs[canvasDocs.length - 1] ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SUBAGENT] Error:', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
