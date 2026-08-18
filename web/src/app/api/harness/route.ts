import { NextRequest } from 'next/server';
import path from 'node:path';
import os from 'node:os';
import { isCrossOriginRequest } from '@/lib/security/same-origin';
import { isAllowedWorkspaceRoot } from '@/lib/security/workspace-root';
import { resolveHarnessExecution } from '@/lib/harness/execution';
import { getProvider } from '@/lib/providers';
import { getSurfaceConfig } from '@/lib/surfaces';
import { TURN_BACKSTOP } from '@/lib/surfaces/shared/limits';
import { loadProvisionedMcpServers } from '@/lib/mcp/provisioned';
import { harnessDir, ensureGitignored, currentRunIndex } from '@/lib/harness/ledger';
import { createSessionRunner } from '@/lib/harness/session';
import { createVerifier, VERIFIER_TOOLS, VERIFIER_DENIED } from '@/lib/harness/verifier';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { startRun, stopRun, runStatus } from '@/lib/harness/runner';

const run = promisify(execFile);

/**
 * `git status --porcelain`, or an empty string outside a repo.
 *
 * Fingerprints the working tree either side of the verifier so a verdict from a
 * run that CHANGED anything can be discarded — the rule that closes the hole
 * left by giving the verifier Bash.
 */
async function treeFingerprint(cwd: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['status', '--porcelain'], { cwd, timeout: 10_000 });
    return `git\n${stdout}`;
  } catch {
    /*
     * Not a repo, or git failed. Returning '' made both fingerprints equal, so
     * `treeUnchanged` was always true and the guard was inert — a Bash-armed
     * verifier could fix what it was checking and its verdict would stand.
     *
     * Fall back to a listing with sizes and mtimes. It is coarser than git but
     * it MOVES when a file is written, which is the only property the guard
     * needs.
     */
    try {
      const { stdout } = await run(
        'sh',
        ['-c', 'find . -type f -not -path "*/.git/*" -not -path "*/node_modules/*" | head -2000 | xargs stat -f "%N %z %m" 2>/dev/null | sort'],
        { cwd, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
      );
      return `stat\n${stdout}`;
    } catch {
      // Nothing worked. A unique value on each call means the two fingerprints
      // differ, so the verdict is DISCARDED — refusing is the safe reading of
      // "we cannot tell".
      return `unknown\n${Math.random()}`;
    }
  }
}


export const runtime = 'nodejs';

/**
 * Start, inspect and stop a long-running goal run.
 *
 * The loop itself lives in the server process rather than the renderer — see
 * `lib/harness/runner.ts`. This route only starts it and reports on it, so a
 * closed window or a switched surface does not end the run.
 *
 * `POST`   { conversationId, workingDir, surfaceId } → start
 * `GET`    ?conversationId&workingDir               → status
 * `DELETE` { conversationId }                        → stop after this session
 */

async function resolveDir(
  workingDir: string,
  conversationId: string,
): Promise<{ ok: true; dir: string } | { ok: false; error: string }> {
  // Real paths on both sides: on macOS `/tmp` is a symlink to `/private/tmp` and
  // the folder picker returns the resolved form, so a literal-prefix check
  // refused every folder under /tmp. See lib/security/workspace-root.ts.
  if (!(await isAllowedWorkspaceRoot(workingDir))) {
    // A distinct message from the cross-origin refusal. Both used to say
    // "Forbidden", which made a real failure indistinguishable from a security
    // one and cost an afternoon.
    return { ok: false, error: 'That folder is outside your home and temp directories' };
  }
  const root = path.resolve(workingDir);
  // The newest run is the one in play. Older ones keep their records.
  const runIndex = await currentRunIndex(root, conversationId);
  return { ok: true, dir: harnessDir(root, conversationId, runIndex ?? undefined) };
}

export async function POST(request: NextRequest) {
  // The API is unauthenticated on loopback and the browser surface loads
  // arbitrary pages; a visited page must not be able to start an autonomous,
  // spending agent rooted wherever it likes.
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
  if (!conversationId) return Response.json({ error: 'conversationId required' }, { status: 400 });
  if (!workingDir) return Response.json({ error: 'workingDir required' }, { status: 400 });

  const resolved = await resolveDir(workingDir, conversationId);
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: 403 });

  // Keep the run's state out of the user's commits.
  await ensureGitignored(path.resolve(workingDir)).catch(() => false);

  const surfaceConfig = getSurfaceConfig(surfaceId);
  const provider = getProvider('claude');
  const mcpServers = await loadProvisionedMcpServers();

  const exec = await resolveHarnessExecution(
    { model: routeModel, providerConfig, apiKey: requestApiKey },
    surfaceConfig.model,
    new URL(request.url).origin,
  );

  const runSession = createSessionRunner({
    chatId: `harness_${conversationId}`,
    cwd: path.resolve(workingDir),
    /*
     * The UNATTENDED backstop, not the interactive one.
     *
     * A goal run is many bounded sessions rather than one long turn — the whole
     * point of the outer loop is that a session ending is normal and recoverable,
     * so each one gets the smaller ceiling. See surfaces/shared/limits.ts for why
     * a turn count is a weak governor in the first place; here the real bounds
     * are the budget and the no-progress detector.
     */
    maxTurns: TURN_BACKSTOP.unattended,
    query: ({ prompt, chatId, maxTurns, cwd }) =>
      provider.query({
        prompt,
        chatId,
        userId: `harness_${conversationId}`,
        mcpServers,
        model: exec.model,
        surfaceId,
        allowedTools: surfaceConfig.allowedTools,
        maxTurns,
        systemPrompt: surfaceConfig.systemPrompt,
        apiKey: exec.apiKey,
        baseUrl: exec.baseUrl,
        providerEnv: exec.providerEnv,
        cwd,
      }) as AsyncIterable<{ type: string; content?: unknown }>,
    estimateCostUsd: (inputTokens, outputTokens) => {
      // Lazily required so the pricing table is not pulled into every request.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { estimateCostUsd } = require('@/lib/models/pricing') as {
        estimateCostUsd: (m: string, i: number, o: number) => number;
      };
      return estimateCostUsd(exec.model || 'claude-sonnet-4-6', inputTokens, outputTokens);
    },
  });

  const cwd = path.resolve(workingDir);
  const verify = createVerifier({
    treeFingerprint: () => treeFingerprint(cwd),
    query: (prompt) =>
      provider.query({
        prompt,
        chatId: `harness_verify_${conversationId}`,
        userId: `harness_${conversationId}`,
        mcpServers,
        // The SAME model as the executor. A cheaper verifier that misses things
        // is worse than none, because it turns an honest "unverified" into a
        // false "verified".
        model: exec.model,
        surfaceId,
        allowedTools: VERIFIER_TOOLS,
        deniedTools: VERIFIER_DENIED,
        maxTurns: TURN_BACKSTOP.unattended,
        systemPrompt: surfaceConfig.systemPrompt,
        apiKey: exec.apiKey,
        baseUrl: exec.baseUrl,
        providerEnv: exec.providerEnv,
        cwd,
      }) as AsyncIterable<{ type: string; content?: unknown }>,
  });

  const started = startRun({ conversationId, dir: resolved.dir, runSession, verify });
  if (!started.ok) return Response.json({ error: started.error }, { status: 409 });

  return Response.json({ ok: true, dir: resolved.dir });
}

export async function GET(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const conversationId = request.nextUrl.searchParams.get('conversationId') ?? '';
  const workingDir = request.nextUrl.searchParams.get('workingDir') ?? '';
  if (!conversationId || !workingDir) {
    return Response.json({ error: 'conversationId and workingDir required' }, { status: 400 });
  }
  const resolved = await resolveDir(workingDir, conversationId);
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: 403 });

  const idx = await currentRunIndex(path.resolve(workingDir), conversationId);
  return Response.json(await runStatus(conversationId, resolved.dir, idx));
}

export async function DELETE(request: NextRequest) {
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
  if (!conversationId) return Response.json({ error: 'conversationId required' }, { status: 400 });

  // Cooperative: the loop halts after the session in flight rather than killing
  // it mid-edit and leaving the working tree in a state nobody chose.
  return Response.json({ ok: true, stopping: stopRun(conversationId) });
}
