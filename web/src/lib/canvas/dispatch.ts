'use client';

import type { A2UIAction, A2UIDocument } from '@/lib/a2ui/types';

/**
 * Dispatches a templated-canvas writeback action against a provisioned MCP
 * tool. Phase 0 implementation routes through /api/subagent so we reuse the
 * same MCP loading + auth path as agent runs. A future optimization can
 * skip the subagent and call the MCP transport directly.
 *
 * Returns the agent's text response (or throws on failure). Surfaces wire
 * this into their canvas `onAction` handler for `tool-call` events.
 */
export async function dispatchCanvasToolCall(
  action: Extract<A2UIAction, { type: 'tool-call' }>,
  opts: { surfaceId?: string; apiKey?: string | null; cwd?: string | null } = {},
): Promise<string> {
  const { surfaceId = 'cowork', apiKey = null, cwd = null } = opts;

  // Build the task. Three modes:
  //   1. tool + args: call the tool exactly with args
  //   2. tool + feedbackPrompt: call the tool, but the prompt steers what to do
  //   3. feedbackPrompt only: pure agent task (e.g. "ask user what changes")
  const hasTool = !!action.tool && action.tool.length > 0;
  const argsBlob = hasTool ? JSON.stringify(action.args ?? {}, null, 2) : '';
  let task: string;
  if (hasTool && action.feedbackPrompt) {
    task = `${action.feedbackPrompt}\n\nUse the \`${action.tool}\` tool with these arguments:\n\`\`\`json\n${argsBlob}\n\`\`\``;
  } else if (hasTool) {
    task = `Call the \`${action.tool}\` tool with these arguments:\n\`\`\`json\n${argsBlob}\n\`\`\`\n\nReport the result in one sentence.`;
  } else if (action.feedbackPrompt) {
    task = action.feedbackPrompt;
  } else {
    throw new Error('Canvas action has neither tool nor feedbackPrompt');
  }

  const response = await fetch('/api/subagent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentChatId: 'canvas-action',
      task,
      surfaceId,
      apiKey: apiKey || undefined,
      cwd: cwd || undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Canvas action failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (typeof data.text === 'string') return data.text;
  if (typeof data.output === 'string') return data.output;
  return JSON.stringify(data);
}

/**
 * Re-run the canvas-generating prompt to refresh state after a writeback.
 * Used by `canvas-overlay` when the current doc has `refreshPrompt` set.
 *
 * The subagent is instructed to emit a fresh A2UIDocument via the `canvas`
 * tool; we pull it from the response's structured payload (preferred) or
 * fall back to scanning text for a JSON block.
 */
export async function refreshCanvasDoc(
  refreshPrompt: string,
  opts: { surfaceId?: string; apiKey?: string | null; cwd?: string | null } = {},
): Promise<A2UIDocument | null> {
  const { surfaceId = 'cowork', apiKey = null, cwd = null } = opts;

  const response = await fetch('/api/subagent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentChatId: 'canvas-refresh',
      task: `${refreshPrompt}\n\nCall the \`canvas\` tool to render the result. Do not respond with prose — only call the canvas tool.`,
      surfaceId,
      apiKey: apiKey || undefined,
      cwd: cwd || undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`Canvas refresh failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  // Preferred: subagent surfaces the canvas tool's input as structured data
  if (data?.canvas && typeof data.canvas === 'object' && data.canvas.version === '1') {
    return data.canvas as A2UIDocument;
  }
  if (Array.isArray(data?.canvasDocs) && data.canvasDocs.length > 0) {
    const last = data.canvasDocs[data.canvasDocs.length - 1];
    if (last?.version === '1') return last as A2UIDocument;
  }
  console.warn('[canvas] refresh subagent returned no canvas payload', data);
  return null;
}
