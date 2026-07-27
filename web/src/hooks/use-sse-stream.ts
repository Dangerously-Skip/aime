'use client';

import { useCallback, useRef } from 'react';
import { streamRegistry } from '@/lib/stream-registry';
import { useConnectorStore } from '@/stores/connector-store';

/**
 * Strip store messages to a lightweight {role, content} array suitable for the history param.
 * Filters to user/assistant with non-empty content.
 */
export function stripMessagesForHistory(
  messages: Array<{ role: string; content: string }>
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
  durationMs: number;
  toolCallCount: number;
  ttftMs?: number;
  clarificationCount?: number;
}

interface UseSSEStreamOptions {
  onChunk: (event: SSEEvent) => void;
  onError: (error: Error) => void;
  onDone: () => void;
  onUsage?: (usage: StreamUsage) => void;
  chatId: string;                            // needed for registry key
  setIsStreaming: (v: boolean) => void;      // from store
  setStreamError: (e: string | null) => void; // from store
}

interface UseSSEStreamReturn {
  sendMessage: (
    message: string,
    chatId: string,
    surfaceId: string,
    model: string,
    extra?: {
      personalPreferences?: string
      displayName?: string
      attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' | 'spreadsheet' | 'presentation' | 'audio' | 'video'; filePath?: string }>
      webSearch?: boolean
      projectInstructions?: string
      projectKnowledge?: string
      apiKey?: string
      cwd?: string
      history?: Array<{ role: 'user' | 'assistant'; content: string }>
      memories?: string
      crossSurfaceContext?: string
      securitySettings?: {
        blockDangerousCommands?: boolean
        blockNetworkCommands?: boolean
        restrictToProjectFolder?: boolean
        disableBashTool?: boolean
      }
      sessionControls?: {
        thinkLevel?: string
        verboseMode?: boolean
        reasoningVisible?: boolean
        modelOverride?: string | null
      }
      toolProfile?: string;
      disabledConnectors?: string[]
      contextBusEvents?: Array<{ summary: string; source: string; priority: string }>
      capability?: string
      tier?: string
      providerConfig?: { providerId: string; transport?: string; baseUrl?: string }
    }
  ) => Promise<void>;
  abort: () => void;
}

function parseSSELines(
  buffer: string,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void
): string {
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
      if (payload === '[DONE]') {
        onDone();
        return '';
      }
      try {
        const parsed = JSON.parse(payload);
        // Spread parsed data so all fields (content, name, id, etc.) are directly accessible
        onEvent(parsed as SSEEvent);
      } catch {
        // Skip unparseable lines
      }
    }
  }

  return remaining;
}

export function useSSEStream(options: UseSSEStreamOptions): UseSSEStreamReturn {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Keep a ref to the chatId that the current stream was started for,
  // so we can abort the correct stream even after conversation switches.
  const activeChatIdRef = useRef<string | null>(null);

  // Inactivity timer ref — hoisted to hook level to avoid Turbopack TDZ issues
  // where the bundler breaks closure scoping of block-scoped variables.
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const abort = useCallback(() => {
    const id = activeChatIdRef.current ?? optionsRef.current.chatId;
    streamRegistry.abort(id);
    activeChatIdRef.current = null;
    optionsRef.current.setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (
      message: string,
      chatId: string,
      surfaceId: string,
      model: string,
      extra?: {
        personalPreferences?: string
        displayName?: string
        attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' | 'spreadsheet' | 'presentation' | 'audio' | 'video'; filePath?: string }>
        webSearch?: boolean
        projectInstructions?: string
        projectKnowledge?: string
        apiKey?: string
        cwd?: string
        history?: Array<{ role: 'user' | 'assistant'; content: string }>
        memories?: string
        crossSurfaceContext?: string
        contextBusEvents?: Array<{ summary: string; source: string; priority: string }>
        securitySettings?: {
          blockDangerousCommands?: boolean
          blockNetworkCommands?: boolean
          restrictToProjectFolder?: boolean
          disableBashTool?: boolean
        }
        sessionControls?: {
          thinkLevel?: string
          verboseMode?: boolean
          reasoningVisible?: boolean
          modelOverride?: string | null
        }
        toolProfile?: string;
        disabledConnectors?: string[]
        capability?: string
        tier?: string
        providerConfig?: { providerId: string; transport?: string; baseUrl?: string }
      }
    ): Promise<void> => {
      // Abort any existing stream for this chatId
      if (streamRegistry.has(chatId)) {
        streamRegistry.abort(chatId);
      }

      const controller = new AbortController();
      streamRegistry.set(chatId, controller);
      activeChatIdRef.current = chatId;

      // Snapshot the callbacks at send time so a conversation switch
      // mid-stream doesn't redirect chunks to the wrong chatId.
      const pinnedOnChunk = optionsRef.current.onChunk;
      const pinnedOnDone = optionsRef.current.onDone;
      const pinnedOnError = optionsRef.current.onError;
      const pinnedOnUsage = optionsRef.current.onUsage;
      const pinnedSetIsStreaming = optionsRef.current.setIsStreaming;
      const pinnedSetStreamError = optionsRef.current.setStreamError;

      pinnedSetIsStreaming(true);
      pinnedSetStreamError(null);

      let firstTokenAt: number | null = null;
      let clarificationCount = 0;

      try {
        const response = await fetch(`/api/chat/${surfaceId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            chatId,
            model,
            ...(extra?.personalPreferences ? { personalPreferences: extra.personalPreferences } : {}),
            ...(extra?.displayName ? { displayName: extra.displayName } : {}),
            ...(extra?.attachments?.length ? { attachments: extra.attachments } : {}),
            ...(extra?.webSearch ? { webSearch: true } : {}),
            ...(extra?.projectInstructions ? { projectInstructions: extra.projectInstructions } : {}),
            ...(extra?.projectKnowledge ? { projectKnowledge: extra.projectKnowledge } : {}),
            ...(extra?.apiKey ? { apiKey: extra.apiKey } : {}),
            ...(extra?.cwd ? { cwd: extra.cwd } : {}),
            ...(extra?.history?.length ? { history: extra.history } : {}),
            ...(extra?.memories ? { memories: extra.memories } : {}),
            ...(extra?.crossSurfaceContext ? { crossSurfaceContext: extra.crossSurfaceContext } : {}),
            ...(extra?.contextBusEvents?.length ? { contextBusEvents: extra.contextBusEvents } : {}),
            ...(extra?.securitySettings ? { securitySettings: extra.securitySettings } : {}),
            ...(extra?.sessionControls ? { sessionControls: extra.sessionControls } : {}),
            ...(extra?.toolProfile ? { toolProfile: extra.toolProfile } : {}),
            ...(extra?.capability ? { capability: extra.capability } : {}),
            ...(extra?.tier ? { tier: extra.tier } : {}),
            ...(extra?.providerConfig ? { providerConfig: extra.providerConfig } : {}),
            // Connectors the user switched off must not have their MCP servers
            // mounted (P3.5). Resolved HERE rather than at each call site: there
            // are five of them across four surfaces, and one forgetting would
            // silently mount a disabled service.
            ...(() => {
              const ids = extra?.disabledConnectors
                ?? useConnectorStore.getState().getDisabledConnectorIds();
              return ids.length ? { disabledConnectors: ids } : {};
            })(),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        // Inactivity timeout — abort if no data arrives for 120s.
        // The server sends SSE heartbeat comments every ~30s, so 120s of
        // silence means the connection or agent is truly stuck.
        // Timer ref is hoisted to hook-level useRef to avoid Turbopack TDZ
        // issues where the bundler breaks closure scoping of block-scoped vars.
        const INACTIVITY_TIMEOUT_MS = 120_000;
        const startInactivityTimer = () => {
          inactivityTimerRef.current = setTimeout(() => {
            console.warn('[SSE] Inactivity timeout — no data for 120s, aborting');
            controller.abort();
          }, INACTIVITY_TIMEOUT_MS);
        };
        const resetInactivityTimer = () => {
          if (inactivityTimerRef.current !== undefined) clearTimeout(inactivityTimerRef.current);
          startInactivityTimer();
        };
        startInactivityTimer();

        while (!done) {
          const result = await reader.read();
          resetInactivityTimer();
          if (result.done) {
            if (buffer.trim()) {
              parseSSELines(buffer + '\n', pinnedOnChunk, () => {});
            }
            done = true;
            break;
          }

          buffer += decoder.decode(result.value, { stream: true });
          buffer = parseSSELines(
            buffer,
            (event) => {
              // Track TTFT on first text/thinking event
              if (!firstTokenAt && (event.type === 'text' || event.type === 'thinking')) {
                firstTokenAt = Date.now();
              }
              // Count clarification prompts
              if (event.type === 'input_request') {
                clarificationCount++;
              }
              // Intercept done event to extract usage metrics
              if (event.type === 'done' && event.usage && pinnedOnUsage) {
                const ttftMs = firstTokenAt ? firstTokenAt - (Date.now() - (event.usage as Record<string,number>).durationMs) : undefined;
                pinnedOnUsage({
                  ...(event.usage as StreamUsage),
                  ttftMs,
                  clarificationCount,
                });
                return; // don't pass done event to onChunk
              }
              pinnedOnChunk(event);
            },
            () => { done = true; }
          );

          if (done) {
            reader.cancel();
            break;
          }
        }

        pinnedOnDone();
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // If this was an inactivity timeout (not user-initiated), show an error
          if (!streamRegistry.has(chatId)) {
            pinnedSetStreamError('Request timed out — the agent may be stuck. Try again.');
          }
          return;
        }
        const err = error instanceof Error ? error : new Error(String(error));
        pinnedSetStreamError(err.message);
        pinnedOnError(err);
      } finally {
        if (inactivityTimerRef.current !== undefined) clearTimeout(inactivityTimerRef.current);
        streamRegistry.clear(chatId);
        activeChatIdRef.current = null;
        pinnedSetIsStreaming(false);
      }
    },
    []
  );

  return { sendMessage, abort };
}
