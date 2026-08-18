import { NextRequest } from 'next/server';
import path from 'node:path';
import os from 'node:os';
import { isCrossOriginRequest } from '@/lib/security/same-origin';
import { isAllowedWorkspaceRoot } from '@/lib/security/workspace-root';
import { resolveHarnessExecution } from '@/lib/harness/execution';
import { getProvider } from '@/lib/providers';
import { getSurfaceConfig } from '@/lib/surfaces';
import { harnessDir, ensureGitignored, nextRunIndex } from '@/lib/harness/ledger';
import { initializeGoal } from '@/lib/harness/initializer';
import { isRunning } from '@/lib/harness/runner';

export const runtime = 'nodejs';

/**
 * Plan a goal run: turn what the user asked for into a goal and a task list.
 *
 * A separate route from starting the run, because they fail differently and the
 * user should see which happened. A plan that comes back unusable is worth
 * showing and retrying; a run that will not start is not the same problem.
 */

/** Planning reads the project but must not change it. */
const PLANNER_TOOLS = ['Read', 'Glob', 'Grep'];

/**
 * The tools the planner must not have.
 *
 * `deniedTools`, not a narrowed `allowedTools` — that is an AUTO-APPROVE list,
 * so removing a name from it withholds nothing. This repo shipped four security
 * toggles that made exactly that mistake. `deniedTools` is enforced twice: handed
 * to the SDK as `disallowedTools` so the model never sees them, and refused again
 * in `canUseTool`, which runs whatever `permissionMode` says.
 */
export const PLANNER_DENIED = ['Write', 'Edit', 'NotebookEdit', 'Bash', 'ExcelWrite', 'ExcelEdit'];

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
  const workingDir = typeof body.workingDir === 'string' ? body.workingDir : '';
  const objective = typeof body.objective === 'string' ? body.objective : '';
  const surfaceId = typeof body.surfaceId === 'string' ? body.surfaceId : 'cowork';
  /*
   * The route the CLIENT already resolved via resolveSendRoute. Resolving a
   * model here instead would resolve against the built-in Anthropic registry and
   * demand an Anthropic key — dead for an OpenRouter-only user, which is the
   * defect the browser surface shipped for months.
   */
  const routeModel = typeof body.model === 'string' ? body.model : null;
  const providerConfig = (body.providerConfig ?? null) as Parameters<typeof resolveHarnessExecution>[0]['providerConfig'];
  const requestApiKey = typeof body.apiKey === 'string' ? body.apiKey : null;
  const budgetUsd = typeof body.budgetUsd === 'number' ? body.budgetUsd : null;
  const deadlineIso = typeof body.deadlineIso === 'string' ? body.deadlineIso : null;
  const sessionCap = typeof body.sessionCap === 'number' ? body.sessionCap : null;

  if (!conversationId) return Response.json({ error: 'conversationId required' }, { status: 400 });
  if (!workingDir) return Response.json({ error: 'workingDir required' }, { status: 400 });
  if (!objective.trim()) return Response.json({ error: 'objective required' }, { status: 400 });

  const resolvedRoot = path.resolve(workingDir);
  if (!(await isAllowedWorkspaceRoot(resolvedRoot))) {
    // Distinct from the cross-origin refusal above: both said "Forbidden", which
    // made a legitimate folder failure look like a security block.
    return Response.json(
      { error: 'That folder is outside your home and temp directories' },
      { status: 403 },
    );
  }

  // Re-planning under a live run would orphan the ledger it is mid-way through.
  if (isRunning(conversationId)) {
    return Response.json({ error: 'a run is already in progress' }, { status: 409 });
  }

  await ensureGitignored(resolvedRoot).catch(() => false);

  /*
   * A NEW numbered run each time, rather than one goal per chat forever.
   *
   * Finishing something and then wanting the next thing done is how work goes;
   * forcing a new conversation for it throws away the context of what just
   * happened. Numbers are never reused, so each run keeps its own ledger,
   * progress log and verdicts.
   */
  const runIndex = await nextRunIndex(resolvedRoot, conversationId);
  const dir = harnessDir(resolvedRoot, conversationId, runIndex);
  const surfaceConfig = getSurfaceConfig(surfaceId);
  const provider = getProvider('claude');
  const exec = await resolveHarnessExecution(
    { model: routeModel, providerConfig, apiKey: requestApiKey },
    surfaceConfig.model,
    new URL(request.url).origin,
  );

  const result = await initializeGoal({
    dir,
    objective,
    budgetUsd,
    deadlineIso,
    sessionCap,
    plan: async (prompt) => {
      let text = '';
      for await (const chunk of provider.query({
        prompt,
        chatId: `harness_init_${conversationId}`,
        userId: `harness_${conversationId}`,
        mcpServers: {},
        model: exec.model,
        surfaceId,
        /*
         * READ-ONLY. The planner decides what "done" means, so letting it also
         * start doing the work would make the plan a description of whatever it
         * happened to try first — and `allowedTools` is an auto-approve list
         * rather than a restriction, so the denial has to be explicit.
         */
        allowedTools: PLANNER_TOOLS,
        deniedTools: PLANNER_DENIED,
        maxTurns: 20,
        systemPrompt: surfaceConfig.systemPrompt,
        apiKey: exec.apiKey,
        baseUrl: exec.baseUrl,
        providerEnv: exec.providerEnv,
        cwd: resolvedRoot,
      }) as AsyncIterable<{ type: string; content?: unknown }>) {
        if (chunk.type === 'text' && typeof chunk.content === 'string') text += chunk.content;
      }
      return text;
    },
  });

  if (!result.ok) return Response.json({ error: result.error }, { status: 422 });
  return Response.json({ ok: true, goal: result.goal, ledger: result.ledger, dir, runIndex });
}
