'use client';

import { useCallback, useRef } from 'react';
import {
  streamRegistry,
  StreamAbortCause,
  abortReasonOf,
  notifyStreamAborted,
} from '@/lib/stream-registry';
import { useConnectorStore } from '@/stores/connector-store';

/** Abort the stream if no data arrives for this long (the server heartbeats ~30s). */
const INACTIVITY_TIMEOUT_MS = 120_000;

/** What the user is told when a stream dies of inactivity. */
const INACTIVITY_TIMEOUT_MESSAGE =
  'Request timed out — the agent may be stuck. Try again.';

/**
 * Cross-realm-safe AbortError check. `error instanceof DOMException` is false
 * whenever the error crosses a realm boundary (jsdom vs node in tests, and any
 * cross-context fetch at runtime), so match on the name instead.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

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
  /**
   * A stream failed, including an inactivity timeout. NOT called for a
   * deliberate stop — the surfaces append this to the transcript as
   * `**Error:** …`, and a user who pressed Stop must not be shown an error.
   */
  onError: (error: Error) => void;
  /** The stream finished on its own. Aborted streams never reach this. */
  onDone: () => void;
  onUsage?: (usage: StreamUsage) => void;
  chatId: string;                            // needed for registry key
  /** Store-level flag: gates the composer, NOT the per-message spinner. */
  setIsStreaming: (v: boolean) => void;
  /** Write-only store field — see the note on `ChatState.streamError`. */
  setStreamError: (e: string | null) => void;
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
    // Deliberate: the user asked for this. The running stream reads the cause
    // off its signal and finalises the turn without reporting an error.
    streamRegistry.abort(id, 'user');
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
      // A new turn replaces any stream still running for this chat. Tagged
      // 'superseded' so the outgoing stream knows the chat's UI state now
      // belongs to this one and leaves it alone.
      streamRegistry.abort(chatId, 'superseded');

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
        const startInactivityTimer = () => {
          inactivityTimerRef.current = setTimeout(() => {
            console.warn(
              `[SSE] Inactivity timeout — no data for ${INACTIVITY_TIMEOUT_MS / 1000}s, aborting`
            );
            // Tag the cause: this is a failure to report, not a user cancel.
            controller.abort(new StreamAbortCause('timeout'));
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
        // WHY the stream ended comes from the explicit cause on our own signal.
        // An AbortError with no cause (an abort raised outside this hook) is
        // treated as deliberate — the safe reading, since it invents no error.
        const abortReason =
          abortReasonOf(controller.signal) ?? (isAbortError(error) ? 'user' : null);

        if (abortReason === 'superseded') {
          // The replacement stream owns this chat's messages now. Finalising
          // here would clear the spinner off a turn that is still running.
          return;
        }

        if (abortReason === 'timeout') {
          // A timeout is a failure the user has to see, so it goes down the
          // same path as any other stream error. notifyStreamAborted first so
          // message state is finalised even if a surface's onError resolves a
          // different chatId than the one this stream was started for.
          notifyStreamAborted({ chatId, reason: 'timeout' });
          pinnedSetStreamError(INACTIVITY_TIMEOUT_MESSAGE);
          pinnedOnError(new Error(INACTIVITY_TIMEOUT_MESSAGE));
          return;
        }

        if (abortReason === 'user') {
          // Deliberate stop: Stop button, conversation switch, stuck-tool
          // cancel. Finalise the turn silently — no error text for something
          // the user asked for, and NOT via onDone, whose surface handlers
          // treat the turn as successfully completed (cowork's even
          // auto-continues, which would resurrect the stream just killed).
          notifyStreamAborted({ chatId, reason: 'user' });
          return;
        }

        const err = error instanceof Error ? error : new Error(String(error));
        pinnedSetStreamError(err.message);
        pinnedOnError(err);
      } finally {
        // Only the stream that still owns the chat may reset shared state: a
        // superseded stream settling late must not delete the live stream's
        // registry entry, drop its inactivity timer, or flip its flag off.
        if (streamRegistry.release(chatId, controller)) {
          if (inactivityTimerRef.current !== undefined) clearTimeout(inactivityTimerRef.current);
          // Only surrender the abort target if it is still pointing at us.
          if (activeChatIdRef.current === chatId) activeChatIdRef.current = null;
          pinnedSetIsStreaming(false);
        }
      }
    },
    []
  );

  return { sendMessage, abort };
}
