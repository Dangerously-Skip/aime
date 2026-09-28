'use client';

import type { A2UIAction, A2UIDocument } from '@/lib/a2ui/types';
import { resolveSendRoute } from '@/lib/models/client-options';
import { getSurfaceRoute } from '@/lib/models/surface-routes';
import type { ProviderExecConfig } from '@/lib/models/execution';
import { getBuiltinAccess } from '@/hooks/use-builtin-access';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';

export interface CanvasDispatchOptions {
  surfaceId?: string;
  /**
   * @deprecated Ignored. The server reads the Anthropic key saved in Settings
   * from its credential store; the browser no longer sends it. Kept only so the
   * existing caller type-checks until it stops passing one.
   */
  apiKey?: string | null;
  cwd?: string | null;
}

/**
 * The model route for a canvas subagent run: the surface's intent, resolved
 * through `resolveSendRoute` like every turn, so the user's tier grid and BYOK
 * providers govern it. `/api/subagent` used to receive neither, and resolved
 * against the built-in Anthropic registry — dead for an OpenRouter-only user.
 *
 * Unpinned on purpose: a canvas action is not a turn in the conversation, so it
 * follows Settings rather than whatever the composer happens to have selected.
 */
async function subagentRoute(
  surfaceId: string,
): Promise<{ model: string | null; providerConfig: ProviderExecConfig | null }> {
  const access = await getBuiltinAccess();
  const route = resolveSendRoute(null, useProviderStore.getState().providers, {
    capability: getSurfaceRoute(surfaceId).capability,
    tierModels: useSettingsStore.getState().tierModels,
    hasAnthropicKey: access.hasAnthropicKey,
    hasBedrock: access.hasBedrock,
    known: access.known,
  });
  return { model: route?.model ?? null, providerConfig: route?.providerConfig ?? null };
}

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
  opts: CanvasDispatchOptions = {},
): Promise<string> {
  const { surfaceId = 'cowork', cwd = null } = opts;

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

  // Allow the dispatched tool through even if the surface config doesn't normally
  // expose it (e.g. transitionJiraIssue from chat surface).
  const extraAllowedTools = hasTool ? [action.tool as string] : [];

  const response = await fetch('/api/subagent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentChatId: 'canvas-action',
      task,
      surfaceId,
      ...(await subagentRoute(surfaceId)),
      cwd: cwd || undefined,
      extraAllowedTools,
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
  opts: CanvasDispatchOptions = {},
): Promise<A2UIDocument | null> {
  const { surfaceId = 'cowork', cwd = null } = opts;

  const response = await fetch('/api/subagent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentChatId: 'canvas-refresh',
      task: `${refreshPrompt}\n\nCall the \`canvas\` tool to render the result. Do not respond with prose — only call the canvas tool.`,
      surfaceId,
      ...(await subagentRoute(surfaceId)),
      cwd: cwd || undefined,
      // Refresh prompts often need MCP tools the surface doesn't expose
      // (e.g. Atlassian + canvas from chat). We don't know which exactly,
      // so request the union of canvas + common MCP-prefixed read tools.
      // Granted MCPs from claude-provider are still gated by their own auth.
      extraAllowedTools: [
        'mcp__aime__canvas',
        // Atlassian read paths used by jira_kanban refresh (aime-* current, nib-* legacy)
        'mcp__aime-mcp-atlassian__searchJiraIssuesUsingJql',
        'mcp__aime-mcp-atlassian__getTransitionsForJiraIssue',
        'mcp__aime-mcp-atlassian__getAccessibleAtlassianResources',
        'mcp__nib-mcp-atlassian__searchJiraIssuesUsingJql',
        'mcp__nib-mcp-atlassian__getTransitionsForJiraIssue',
        'mcp__nib-mcp-atlassian__getAccessibleAtlassianResources',
        'mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql',
        'mcp__claude_ai_Atlassian__getTransitionsForJiraIssue',
        'mcp__claude_ai_Atlassian__getAccessibleAtlassianResources',
      ],
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
