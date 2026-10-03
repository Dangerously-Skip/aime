import { NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';
import { getSurfaceConfig } from '@/lib/surfaces';
import { loadAgents, readAgentSystemPrompt } from '@/lib/agents-parser';
import { loadProvisionedMcpServers } from '@/lib/mcp/provisioned';
import { resolveBuiltinSurfaceModel, resolveTurnExecution } from '@/lib/models/server-turn';
import { NO_MODEL_MESSAGE } from '@/lib/models/credential-check';
import { classifyThrownTurnError } from '@/lib/providers/turn-errors';
import type { ProviderExecConfig } from '@/lib/models/execution';
import type { Capability, Tier } from '@/lib/models/types';
import { collectRefusals } from '@/lib/runs/runs';

export const runtime = 'nodejs';

/**
 * POST /api/subagent
 * Spawns an isolated sub-agent run and returns its full text output.
 *
 * Body:
 *   parentChatId - ID of the parent conversation (for correlation)
 *   task         - The task prompt to run
 *   surfaceId    - Which surface config to use (default: cowork)
 *   model          - The model the client's `resolveSendRoute` chose
 *   providerConfig - Its user-added provider, when it has one (same contract
 *                    as /api/chat/[surfaceId]); without it an OpenRouter-only
 *                    user's subagent ran on the built-in registry and died
 *   capability/tier - The built-in intent when nothing is pinned
 *   apiKey         - Optional transient API key
 *   cwd            - Optional working directory
 *   agentName      - Optional named agent config to use
 *   extraAllowedTools - Tools to expose beyond the surface's own
 *   attended       - true ONLY when a person's click started this run and
 *                    they are waiting on it (Create PR, a canvas button).
 *                    Absent ⇒ unattended. Anything but a boolean ⇒ 400.
 *
 * The run is tied to the request: a caller that goes away stops it.
 *
 * ## Attended or not is the CALLER's statement, and absence is the safe side
 *
 * The `subagent_` chatId prefix cannot tell a user's click from a follow-up the
 * app fired on its own, so the request says which it is:
 *
 *   attended: true  → approval policy 'never' — acts like a chat the user is
 *                     watching. The tools in `extraAllowedTools` are the ones
 *                     the click named, so they count as approved for the
 *                     connector gate's "ask first" question (which this run has
 *                     no client to ask). The Security settings, the user's
 *                     connector blocks and money-handling servers still refuse.
 *   absent / false  → 'consequential': reads and in-app actions only; anything
 *                     with effects outside the app is refused, and nothing in
 *                     `extraAllowedTools` is pre-approved.
 *
 * Why claiming `attended` cannot broaden what an UNATTENDED run may do: the
 * route needs the local API credential, so only the renderer reaches it, and no
 * server-side scheduler calls it. The one way an unattended run could POST here
 * is its own model making the request — Bash (curl, node, python…) classifies
 * as consequential and is refused under the policy those runs carry, the
 * built-in WebFetch is withheld, and FetchUrl is a GET that refuses private
 * addresses. A run that already has 'never' gains nothing by calling it.
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
    extraAllowedTools = null,
    providerConfig = null,
    capability = null,
    tier = null,
    attended: attendedField,
  } = body as {
    parentChatId?: string;
    task?: string;
    surfaceId?: string;
    model?: string | null;
    apiKey?: string | null;
    cwd?: string | null;
    agentName?: string | null;
    extraAllowedTools?: string[] | null;
    providerConfig?: ProviderExecConfig | null;
    capability?: Capability | null;
    tier?: Tier | null;
    attended?: unknown;
  };

  if (!task || typeof task !== 'string') {
    return Response.json({ error: 'task is required' }, { status: 400 });
  }
  // Strictly a boolean: "true", 1 or {} must not read as a person's click.
  if (attendedField !== undefined && typeof attendedField !== 'boolean') {
    return Response.json({ error: 'attended must be a boolean' }, { status: 400 });
  }
  const attended = attendedField === true;
  if (
    extraAllowedTools !== null &&
    (!Array.isArray(extraAllowedTools) || extraAllowedTools.some((t) => typeof t !== 'string'))
  ) {
    return Response.json({ error: 'extraAllowedTools must be an array of tool names' }, { status: 400 });
  }

  const subagentId = `subagent_${parentChatId ?? 'anon'}_${Date.now()}`;
  console.log('[SUBAGENT] Spawning sub-agent:', subagentId, attended ? '(attended)' : '(unattended)', '| task:', task.slice(0, 80), agentName ? `| agent: ${agentName}` : '');

  try {
    const provider = getProvider('claude');
    const surfaceConfig = getSurfaceConfig(surfaceId as string);

    // Resolve named agent config if provided
    let agentAllowedTools: string[] | undefined;
    let agentSystemPrompt: string | undefined;
    if (agentName) {
      const agents = loadAgents((cwd as string) || undefined);
      const agentConfig = agents.find((a) => a.name === agentName);
      if (agentConfig) {
        // Not its `model:` — models come from Settings (see the chat route).
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
        console.log('[SUBAGENT] Resolved agent config:', agentName);
      } else {
        console.warn('[SUBAGENT] Agent not found:', agentName, '— using surface defaults');
      }
    }

    // Credentials and model the same way the chat route resolves them.
    const { exec, usable } = await resolveTurnExecution({
      providerConfig,
      requestApiKey: apiKey,
      shimOrigin: new URL(req.url).origin,
    });
    if (!usable) {
      return Response.json({ error: NO_MODEL_MESSAGE, code: 'no_model' }, { status: 400 });
    }
    const pinned = (model as string) || null;
    const runModel =
      pinned ||
      (providerConfig
        ? undefined
        : resolveBuiltinSurfaceModel({
            surfaceId: surfaceId as string,
            capability,
            tier,
            hasAnthropicKey: !!exec.apiKey,
          })?.model) ||
      surfaceConfig.model;

    // Load the same MCP servers the main chat route does — without this the
    // spawned subagent has no OAuth-provisioned tools (Atlassian, GitHub,
    // Slack, Confluence, etc.) and can't perform canvas writebacks.
    const mcpServers = await loadProvisionedMcpServers();

    /*
     * A caller that goes away stops the run. Nothing tied the two together, so
     * a closed canvas or a cancelled PR dialog left a whole agent run going —
     * spending, and writing files — for a response nobody would read.
     */
    const stop = () => {
      console.warn('[SUBAGENT] Caller disconnected — aborting', subagentId);
      provider.abort(subagentId, surfaceId as string);
    };
    if (req.signal.aborted) return Response.json({ error: 'cancelled' }, { status: 499 });
    req.signal.addEventListener('abort', stop, { once: true });

    let output = '';
    let failure: { message: string; code: unknown } | null = null;
    const canvasDocs: unknown[] = [];
    const refused = collectRefusals();
    try {
      for await (const chunk of provider.query({
        prompt: task,
        chatId: subagentId,
        userId: `subagent_${parentChatId ?? 'anon'}`,
        mcpServers,
        model: runModel,
        surfaceId: surfaceId as string,
        allowedTools: (() => {
          const base = agentAllowedTools ?? surfaceConfig.allowedTools ?? [];
          if (!extraAllowedTools || extraAllowedTools.length === 0) return base;
          // Union (preserve order). Lets canvas writebacks call MCP tools that
          // the surface doesn't normally expose (e.g. transitionJiraIssue from
          // chat surface).
          const seen = new Set(base);
          const extra = extraAllowedTools.filter((t) => !seen.has(t));
          return [...base, ...extra];
        })(),
        maxTurns: Math.min(surfaceConfig.maxTurns ?? 10, 20), // cap sub-agent turns
        systemPrompt: agentSystemPrompt ?? surfaceConfig.systemPrompt,
        apiKey: exec.apiKey,
        baseUrl: exec.baseUrl,
        providerEnv: exec.env,
        cwd: (cwd as string) || undefined,
        approvalPolicy: attended ? 'never' : 'consequential',
        userApprovedTools: attended && extraAllowedTools ? extraAllowedTools : undefined,
        onToolRefused: refused.record,
      })) {
        if (chunk.type === 'text') {
          output += (chunk.content as string) || '';
        } else if (chunk.type === 'canvas' && chunk.doc) {
          // Used by the canvas auto-refresh path — the caller wants the
          // resulting A2UIDocument, not just text.
          canvasDocs.push(chunk.doc);
        } else if (chunk.type === 'error' && !failure) {
          // A typed turn failure (auth, billing, …) is a failure, not an empty
          // success with whatever text preceded it.
          failure = { message: chunk.message ?? 'The sub-agent failed', code: chunk.code };
        }
      }
    } finally {
      req.signal.removeEventListener('abort', stop);
    }

    if (req.signal.aborted) return Response.json({ error: 'cancelled' }, { status: 499 });
    if (failure) {
      console.error('[SUBAGENT] Failed:', subagentId, failure.code, failure.message);
      return Response.json({ error: failure.message, code: failure.code, refused: refused.list }, { status: 502 });
    }

    console.log('[SUBAGENT] Completed:', subagentId, '| output length:', output.length, '| canvas docs:', canvasDocs.length);
    return Response.json({
      ok: true,
      subagentId,
      parentChatId,
      output,
      canvasDocs,
      canvas: canvasDocs[canvasDocs.length - 1] ?? null,
      // What the gate refused, so the caller can say so instead of only
      // reporting that the output was not what it expected.
      refused: refused.list,
    });
  } catch (err) {
    const { code, message } = classifyThrownTurnError(err);
    console.error('[SUBAGENT] Error:', code, message);
    return Response.json({ error: message, code }, { status: 500 });
  }
}
