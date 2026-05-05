'use client';

import type { A2UIAction } from '@/lib/a2ui/types';

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

  const argsBlob = JSON.stringify(action.args, null, 2);
  const task = action.feedbackPrompt
    ? `${action.feedbackPrompt}\n\nUse the \`${action.tool}\` tool with these arguments:\n\`\`\`json\n${argsBlob}\n\`\`\``
    : `Call the \`${action.tool}\` tool with these arguments:\n\`\`\`json\n${argsBlob}\n\`\`\`\n\nReport the result in one sentence.`;

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
