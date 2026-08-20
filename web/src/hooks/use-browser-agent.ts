'use client';

import { recordAndDetect, type LoopCall } from '@/lib/agent/loop-detector';
import { useCallback, useRef } from 'react';
import {
  BROWSER_TOOL_SCHEMAS,
  DOM_EXTRACTION_SCRIPT,
  executeToolInWebview,
  formatPageStateForModel,
  formatPageChangeForModel,
  formatTabListForModel,
  type ConsoleLogBuffer,
  type PageState,
  type TabInfo,
  type WebviewRef,
} from '@/lib/browser-tools';
import { parseSSELines } from '@/lib/sse/parse-sse-lines';
import type { ProviderExecConfig } from '@/lib/models/execution';

/**
 * Where this turn should run. Produced by `resolveSendRoute` in the surface —
 * the one chokepoint that honours the tier grid and user-added providers.
 * Both fields null/undefined means "nothing resolved"; the server then falls
 * back to its own registry lookup.
 */
export interface BrowserTurnRoute {
  model: string | null;
  providerConfig?: ProviderExecConfig | null;
}
import { getBrowserConfig } from '@/lib/surfaces/browser-config';
import type { PendingContextItem } from '@/lib/browser-interactions';

const MAX_ITERATIONS = 25;
const DOM_EXTRACT_TIMEOUT = 5000; // 5s timeout for page state extraction

/** Execute JS on webview with a timeout to prevent hanging during navigation */
async function extractPageState(webview: WebviewRef): Promise<PageState | null> {
  try {
    const result = await Promise.race([
      webview.executeJavaScript(DOM_EXTRACTION_SCRIPT),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('DOM extraction timed out')), DOM_EXTRACT_TIMEOUT)
      ),
    ]);
    return result as PageState | null;
  } catch {
    return null;
  }
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

interface UseBrowserAgentOptions {
  onText: (text: string) => void;
  onToolUse: (id: string, name: string, input: Record<string, unknown>) => void;
  onToolResult: (id: string, result: string, isError: boolean) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  onPhaseChange: (phase: 'idle' | 'observing' | 'thinking' | 'acting') => void;
  apiKey?: string | null;
  memories?: string;
  consoleBuffer?: ConsoleLogBuffer;
  /** Current tabs for multi-tab awareness */
  getTabs?: () => TabInfo[];
  /** Switch to a different tab by its tab ID. Returns the new webview ref after load. */
  onSwitchTab?: (tabId: string) => Promise<WebviewRef | null>;
  /** Open a URL in a NEW background tab. Returns the new tab's index. */
  onNewTab?: (url: string) => Promise<number | null>;
  /** Close a tab by id. */
  onCloseTab?: (tabId: string) => Promise<boolean>;
}

export function useBrowserAgent(options: UseBrowserAgentOptions) {
  const abortRef = useRef<AbortController | null>(null);
  /*
   * The previous observation, so each new one can say what moved. Agent-E calls
   * this "change observation"; without it the agent got a fresh complete page
   * every step with nothing marking it as a DIFFERENT page, and navigating away
   * from its own results was invisible.
   */
  const prevObservedRef = useRef<{ url: string; title: string; elementCount: number } | null>(null);
  /* Per-run window for the shared loop detector (lib/agent/loop-detector). */
  const loopWindowRef = useRef<LoopCall[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    optionsRef.current.onPhaseChange('idle');
  }, []);

  const runAgentLoop = useCallback(
    async (userMessage: string, route: BrowserTurnRoute, initialWebview: WebviewRef, pendingContext?: PendingContextItem[]) => {
      let webview = initialWebview;
      // Abort any previous run
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const config = getBrowserConfig();
      let systemPrompt = config.systemPrompt as string;
      if (optionsRef.current.memories) {
        systemPrompt = `${systemPrompt}\n\n${optionsRef.current.memories}`;
      }
      const messages: AnthropicMessage[] = [];

      try {
        // 1. Observe — extract current page state
        optionsRef.current.onPhaseChange('observing');
        // A fresh run gets a fresh window; a loop from last time is not this one's.
        loopWindowRef.current = [];
        const pageState = await extractPageState(webview);
        // Seed the change baseline; the first observation has nothing to differ from.
        // Null means extraction failed — leave the baseline unset rather than
        // inventing one, so the next diff reports honestly.
        prevObservedRef.current = pageState
          ? { url: pageState.url, title: pageState.title, elementCount: pageState.elementCount }
          : null;

        // Build initial user message with page context
        const userContent: Array<{ type: string; text?: string; [key: string]: unknown }> = [];

        // Inject open tabs list for multi-tab awareness
        const tabs = optionsRef.current.getTabs?.() ?? [];
        if (tabs.length > 1) {
          userContent.push({
            type: 'text',
            text: `<open_tabs>\n${formatTabListForModel(tabs)}\n</open_tabs>`,
          });
        }

        if (pageState) {
          userContent.push({
            type: 'text',
            text: `<page_state>\n${formatPageStateForModel(pageState)}\n</page_state>`,
          });
        }

        // Inject pending context items
        if (pendingContext?.length) {
          for (const item of pendingContext) {
            if (item.type === 'screenshot' && item.content.startsWith('data:image/')) {
              // Extract base64 data from data URL
              const match = item.content.match(/^data:image\/([\w+]+);base64,(.+)$/);
              if (match) {
                userContent.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: `image/${match[1]}`,
                    data: match[2],
                  },
                });
              }
            } else {
              userContent.push({
                type: 'text',
                text: `<${item.type}_context>\n${item.content}\n</${item.type}_context>`,
              });
            }
          }
        }

        userContent.push({ type: 'text', text: userMessage });

        messages.push({ role: 'user', content: userContent });

        // Agent loop
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          if (controller.signal.aborted) break;

          // 2. Think — send to API
          optionsRef.current.onPhaseChange('thinking');

          const { assistantBlocks, stopReason } = await sendTurn(
            messages,
            route,
            systemPrompt,
            controller.signal,
            optionsRef.current,
            optionsRef.current.apiKey,
          );

          if (controller.signal.aborted) break;

          // Append assistant response to conversation history
          messages.push({ role: 'assistant', content: assistantBlocks });

          // Check if we're done
          if (stopReason === 'end_turn' || stopReason !== 'tool_use') {
            break;
          }

          // 3. Act — execute tool calls
          optionsRef.current.onPhaseChange('acting');

          const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
          let isDone = false;

          for (const block of assistantBlocks) {
            if (controller.signal.aborted) break;
            if (block.type !== 'tool_use') continue;

            const toolBlock = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

            let result;
            /*
             * Loop check BEFORE dispatch. Denying after the side effect would
             * still burn the action; the point is to stop the fifth identical
             * click, not to report it.
             */
            const loop = recordAndDetect(loopWindowRef.current, toolBlock.name, toolBlock.input);
            if (loop.action === 'deny') {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: loop.message,
                is_error: true,
              });
              optionsRef.current.onToolResult(toolBlock.id, loop.message, true);
              continue;
            }
            if (loop.action === 'warn') {
              console.warn('[browser-agent] repeated call', toolBlock.name, `x${loop.count}`);
            }

            if (toolBlock.name === 'new_tab') {
              result = await handleNewTab(toolBlock.input, optionsRef.current);
            } else if (toolBlock.name === 'close_tab') {
              result = await handleCloseTab(toolBlock.input, optionsRef.current);
            } else if (toolBlock.name === 'switch_tab') {
              // Handle switch_tab specially — manipulates tabs, not the current webview
              result = await handleSwitchTab(toolBlock.input, optionsRef.current, (newWv) => { webview = newWv; });
            } else {
              result = await executeToolInWebview(webview, toolBlock.name, toolBlock.input, optionsRef.current.consoleBuffer);
            }

            optionsRef.current.onToolResult(
              toolBlock.id,
              result.message,
              !result.success,
            );

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: result.message,
              is_error: !result.success,
            });

            if (result.isDone) {
              isDone = true;
              break;
            }
          }

          if (isDone || controller.signal.aborted) break;

          // Re-observe page state after actions
          optionsRef.current.onPhaseChange('observing');
          const newPageState = await extractPageState(webview);
          const changeSummary = newPageState
            ? formatPageChangeForModel(prevObservedRef.current, newPageState)
            : '';
          if (newPageState) {
            prevObservedRef.current = {
              url: newPageState.url,
              title: newPageState.title,
              elementCount: newPageState.elementCount,
            };
          }

          // Build tool results + updated page/tab state as user message
          const userBlocks: Array<{ type: string; [key: string]: unknown }> = [
            ...toolResults,
          ];

          // Include updated tab list if there are multiple tabs
          const updatedTabs = optionsRef.current.getTabs?.() ?? [];
          if (updatedTabs.length > 1) {
            userBlocks.push({
              type: 'text',
              text: `<open_tabs>\n${formatTabListForModel(updatedTabs)}\n</open_tabs>`,
            });
          }

          if (newPageState) {
            userBlocks.push({
              type: 'text',
              text: [
                changeSummary,
                `<page_state>\n${formatPageStateForModel(newPageState)}\n</page_state>`,
              ].filter(Boolean).join('\n\n'),
            });
          }

          messages.push({ role: 'user', content: userBlocks });
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const err = error instanceof Error ? error : new Error(String(error));
        optionsRef.current.onError(err);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        optionsRef.current.onPhaseChange('idle');
        optionsRef.current.onDone();
      }
    },
    [],
  );

  return { runAgentLoop, abort };
}

// ── Internal: handle switch_tab tool ──────────────────────────────────────────

import type { ToolResult } from '@/lib/browser-tools';

async function handleSwitchTab(
  input: Record<string, unknown>,
  options: UseBrowserAgentOptions,
  setWebview: (wv: WebviewRef) => void,
): Promise<ToolResult> {
  const tabIndex = input.tab_index as number;
  const tabs = options.getTabs?.() ?? [];

  if (tabIndex < 0 || tabIndex >= tabs.length) {
    return { success: false, message: `Invalid tab index ${tabIndex}. There are ${tabs.length} tabs (0-${tabs.length - 1}).` };
  }

  const targetTab = tabs[tabIndex];
  if (targetTab.isActive) {
    return { success: true, message: `Already on tab [${tabIndex}] "${targetTab.title}".` };
  }

  if (!options.onSwitchTab) {
    return { success: false, message: 'Tab switching is not available.' };
  }

  const newWebview = await options.onSwitchTab(targetTab.id);
  if (!newWebview) {
    return { success: false, message: 'Failed to switch tab — webview not available after switch.' };
  }

  setWebview(newWebview);
  return { success: true, message: `Switched to tab [${tabIndex}] "${targetTab.title}" — ${targetTab.url || '(empty page)'}. Page state will be observed next.` };
}

// ── Internal: single turn SSE request ────────────────────────────────────────

async function sendTurn(
  messages: AnthropicMessage[],
  route: BrowserTurnRoute,
  system: string,
  signal: AbortSignal,
  callbacks: Pick<UseBrowserAgentOptions, 'onText' | 'onToolUse'>,
  apiKey?: string | null,
): Promise<{
  assistantBlocks: Array<{ type: string; [key: string]: unknown }>;
  stopReason: string;
}> {
  const response = await fetch('/api/chat/browser-turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      // The route comes from the SAME `resolveSendRoute` chokepoint every other
      // surface uses, so the user's tier grid and BYOK providers govern this
      // surface too. Omitted when it resolves to nothing, leaving the server to
      // fall back to the registry.
      ...(route.model ? { model: route.model } : {}),
      ...(route.providerConfig ? { providerConfig: route.providerConfig } : {}),
      system,
      tools: BROWSER_TOOL_SCHEMAS,
      // Still sent when the user has a BYOK key in settings, but no longer
      // required — the server falls back to its own credential store and env.
      ...(apiKey ? { apiKey } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  if (!response.body) throw new Error('Response body is null');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason = 'end_turn';

  // Collect content blocks for conversation history
  const assistantBlocks: Array<{ type: string; [key: string]: unknown }> = [];
  let currentText = '';

  const processEvent = (event: SSEEvent) => {
    switch (event.type) {
      case 'text':
        callbacks.onText(event.content as string);
        currentText += event.content as string;
        break;
      case 'tool_use':
        // Flush accumulated text as a text block
        if (currentText) {
          assistantBlocks.push({ type: 'text', text: currentText });
          currentText = '';
        }
        callbacks.onToolUse(
          event.id as string,
          event.name as string,
          event.input as Record<string, unknown>,
        );
        assistantBlocks.push({
          type: 'tool_use',
          id: event.id as string,
          name: event.name as string,
          input: event.input as Record<string, unknown>,
        });
        break;
      case 'turn_complete':
        stopReason = (event.stop_reason as string) || 'end_turn';
        break;
      case 'error':
        throw new Error(event.message as string);
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      if (buffer.trim()) {
        parseSSELines<SSEEvent>(buffer + '\n', processEvent);
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = parseSSELines<SSEEvent>(buffer, processEvent);
  }

  // Flush any remaining text
  if (currentText) {
    assistantBlocks.push({ type: 'text', text: currentText });
  }

  return { assistantBlocks, stopReason };
}

/**
 * Open a URL in a background tab.
 *
 * Background rather than foreground on purpose: the asking task is "open these
 * several for me to look at", and stealing focus on each one would leave the
 * agent observing a different page than the one it is reasoning about — the
 * drift that caused the original failure, self-inflicted.
 */
async function handleNewTab(
  input: Record<string, unknown>,
  options: UseBrowserAgentOptions,
): Promise<ToolResult> {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) return { success: false, message: 'new_tab needs a url.' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { success: false, message: `Not an absolute URL: "${url}". Include the scheme, e.g. https://…` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // A tool that will open any scheme is a tool that will open file:// on request.
    return { success: false, message: `Refused ${parsed.protocol} — new_tab opens http and https only.` };
  }

  if (!options.onNewTab) {
    /*
     * Say so plainly rather than failing vaguely. The whole reason this tool
     * exists is that an agent which cannot tell "impossible" from "not yet"
     * loops instead of reporting.
     */
    return { success: false, message: 'Opening tabs is not available in this build.' };
  }

  const index = await options.onNewTab(parsed.toString());
  if (index === null) return { success: false, message: `Could not open a tab for ${parsed.toString()}.` };
  return {
    success: true,
    message: `Opened ${parsed.toString()} in background tab [${index}]. You are still on the current page; use switch_tab to go there.`,
  };
}

async function handleCloseTab(
  input: Record<string, unknown>,
  options: UseBrowserAgentOptions,
): Promise<ToolResult> {
  const idx = input.tab_index as number;
  const tabs = options.getTabs?.() ?? [];
  if (typeof idx !== 'number' || idx < 0 || idx >= tabs.length) {
    return { success: false, message: `Invalid tab index ${idx}. There are ${tabs.length} tabs (0-${tabs.length - 1}).` };
  }
  if (tabs.length === 1) {
    return { success: false, message: 'Refusing to close the only tab.' };
  }
  if (!options.onCloseTab) return { success: false, message: 'Closing tabs is not available in this build.' };
  const ok = await options.onCloseTab(tabs[idx].id);
  return ok
    ? { success: true, message: `Closed tab [${idx}] "${tabs[idx].title}".` }
    : { success: false, message: `Could not close tab [${idx}].` };
}
