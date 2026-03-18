'use client';

import { useCallback, useRef } from 'react';
import {
  BROWSER_TOOL_SCHEMAS,
  DOM_EXTRACTION_SCRIPT,
  executeToolInWebview,
  formatPageStateForModel,
  type ConsoleLogBuffer,
  type PageState,
  type WebviewRef,
} from '@/lib/browser-tools';
import { getBrowserConfig } from '@/lib/surfaces/browser-config';
import type { PendingContextItem } from '@/lib/browser-interactions';

const MAX_ITERATIONS = 25;

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
}

export function useBrowserAgent(options: UseBrowserAgentOptions) {
  const abortRef = useRef<AbortController | null>(null);
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
    async (userMessage: string, model: string, webview: WebviewRef, pendingContext?: PendingContextItem[]) => {
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
        let pageState: PageState | null = null;
        try {
          pageState = (await webview.executeJavaScript(DOM_EXTRACTION_SCRIPT)) as PageState;
        } catch {
          // Webview may not have a page loaded yet
        }

        // Build initial user message with page context
        const userContent: Array<{ type: string; text?: string; [key: string]: unknown }> = [];
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
            model,
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
            const result = await executeToolInWebview(webview, toolBlock.name, toolBlock.input, optionsRef.current.consoleBuffer);

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
          let newPageState: PageState | null = null;
          try {
            newPageState = (await webview.executeJavaScript(DOM_EXTRACTION_SCRIPT)) as PageState;
          } catch {
            // Page may be navigating
          }

          // Build tool results + updated page state as user message
          const userBlocks: Array<{ type: string; [key: string]: unknown }> = [
            ...toolResults,
          ];
          if (newPageState) {
            userBlocks.push({
              type: 'text',
              text: `<page_state>\n${formatPageStateForModel(newPageState)}\n</page_state>`,
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

// ── Internal: single turn SSE request ────────────────────────────────────────

async function sendTurn(
  messages: AnthropicMessage[],
  model: string,
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
      model,
      system,
      tools: BROWSER_TOOL_SCHEMAS,
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
        parseSSEBuffer(buffer + '\n', processEvent);
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = parseSSEBuffer(buffer, processEvent);
  }

  // Flush any remaining text
  if (currentText) {
    assistantBlocks.push({ type: 'text', text: currentText });
  }

  return { assistantBlocks, stopReason };
}

// ── SSE parsing (mirrors use-sse-stream.ts logic) ────────────────────────────

function parseSSEBuffer(buffer: string, onEvent: (event: SSEEvent) => void): string {
  const lines = buffer.split('\n');
  let remaining = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === lines.length - 1 && !buffer.endsWith('\n')) {
      remaining = line;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith(':')) continue;

    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return '';
      try {
        onEvent(JSON.parse(payload));
      } catch {
        // Skip unparseable
      }
    }
  }

  return remaining;
}
