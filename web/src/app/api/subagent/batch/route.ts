import { NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';
import { getSurfaceConfig } from '@/lib/surfaces';
import { loadAgents, readAgentSystemPrompt } from '@/lib/agents-parser';

export const runtime = 'nodejs';

const MAX_CONCURRENT = 5;

interface BatchTask {
  task: string;
  surfaceId?: string;
  model?: string | null;
  agentName?: string | null;
}

interface BatchResult {
  ok: boolean;
  task: string;
  output: string;
  error?: string;
  durationMs: number;
}

/**
 * POST /api/subagent/batch
 * Spawns multiple sub-agents concurrently and returns all results.
 *
 * Body:
 *   tasks        - Array of task objects
 *   parentChatId - ID of the parent conversation
 *   apiKey       - Optional API key
 *   cwd          - Optional working directory
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    tasks,
    parentChatId,
    apiKey = null,
    cwd = null,
  } = body as {
    tasks?: BatchTask[];
    parentChatId?: string;
    apiKey?: string | null;
    cwd?: string | null;
  };

  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    return Response.json({ error: 'tasks array is required' }, { status: 400 });
  }

  if (tasks.length > MAX_CONCURRENT) {
    return Response.json({ error: `Maximum ${MAX_CONCURRENT} concurrent tasks` }, { status: 400 });
  }

  console.log('[SUBAGENT/BATCH] Spawning', tasks.length, 'sub-agents for parent:', parentChatId);

  const runOne = async (batchTask: BatchTask, index: number): Promise<BatchResult> => {
    const startMs = Date.now();
    const subagentId = `subagent_batch_${parentChatId ?? 'anon'}_${index}_${Date.now()}`;

    try {
      const provider = getProvider('claude');
      const surfaceId = batchTask.surfaceId || 'cowork';
      const surfaceConfig = getSurfaceConfig(surfaceId);

      // Resolve named agent
      let agentModel: string | undefined;
      let agentAllowedTools: string[] | undefined;
      let agentSystemPrompt: string | undefined;
      if (batchTask.agentName) {
        const agents = loadAgents((cwd as string) || undefined);
        const agentConfig = agents.find((a) => a.name === batchTask.agentName);
        if (agentConfig) {
          agentModel = agentConfig.model;
          if (agentConfig.allowedTools && surfaceConfig.allowedTools) {
            agentAllowedTools = agentConfig.allowedTools.filter((t) =>
              (surfaceConfig.allowedTools as string[]).includes(t)
            );
          } else {
            agentAllowedTools = agentConfig.allowedTools;
          }
          const sp = readAgentSystemPrompt(agentConfig);
          if (sp) agentSystemPrompt = sp;
        }
      }

      let output = '';
      for await (const chunk of provider.query({
        prompt: batchTask.task,
        chatId: subagentId,
        userId: `subagent_${parentChatId ?? 'anon'}`,
        mcpServers: {},
        model: batchTask.model || agentModel || surfaceConfig.model,
        surfaceId,
        allowedTools: agentAllowedTools ?? surfaceConfig.allowedTools,
        maxTurns: Math.min(surfaceConfig.maxTurns ?? 10, 20),
        systemPrompt: agentSystemPrompt ?? surfaceConfig.systemPrompt,
        apiKey: (apiKey as string) || undefined,
        cwd: (cwd as string) || undefined,
      })) {
        if (chunk.type === 'text') {
          output += (chunk.content as string) || '';
        }
      }

      return {
        ok: true,
        task: batchTask.task.slice(0, 100),
        output,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      return {
        ok: false,
        task: batchTask.task.slice(0, 100),
        output: '',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      };
    }
  };

  // Execute all tasks concurrently
  const results = await Promise.allSettled(
    tasks.map((task, i) => runOne(task, i))
  );

  const batchResults: BatchResult[] = results.map((r) =>
    r.status === 'fulfilled' ? r.value : {
      ok: false,
      task: '',
      output: '',
      error: r.reason?.message || 'Unknown error',
      durationMs: 0,
    }
  );

  const succeeded = batchResults.filter((r) => r.ok).length;
  console.log('[SUBAGENT/BATCH] Completed:', succeeded, '/', tasks.length, 'succeeded');

  return Response.json({
    ok: true,
    parentChatId,
    results: batchResults,
    totalTasks: tasks.length,
    succeeded,
  });
}
