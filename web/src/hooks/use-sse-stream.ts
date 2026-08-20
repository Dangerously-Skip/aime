'use client';

import { useCallback, useRef } from 'react';
import {
  streamRegistry,
  StreamAbortCause,
  abortReasonOf,
  abortDetailOf,
  notifyStreamAborted,
} from '@/lib/stream-registry';
import { parseSSELines } from '@/lib/sse/parse-sse-lines';
import { resetTextBoundary } from '@/lib/sse/core-chunks';

/** Abort the stream if no data arrives for this long (the server heartbeats every 15s). */
const INACTIVITY_TIMEOUT_MS = 120_000;

/**
 * What the user is told when a stream dies of inactivity.
 *
 * Two rules, both learned from the message this replaces ("Request timed out —
 * the agent may be stuck. Try again."):
 *
 * 1. Say what actually happened. That text described a dead connection, but the
 *    same code path fires when one slow tool is killed mid-turn, and the two
 *    call for opposite responses.
 * 2. Never tell the user to redo work without telling them it may already exist.
 *    A killed turn leaves whatever it had already written on disk. "Try again"
 *    sent someone to rebuild an 18-slide deck that was sitting in the scratch
 *    directory, complete.
 */
function timeoutMessage(detail?: string): string {
  const what = detail
    ? `The turn was stopped because ${detail}.`
    : 'The connection went quiet for two minutes, so the turn was stopped.';
  return `${what} Anything already written to disk was kept — check Artifacts before running it again.`;
}

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
}

interface UseSSEStreamReturn {
  sendMessage: (
    message: string,
    chatId: string,
    surfaceId: string,
    /** null ⇒ nothing pinned; the server resolves from the registry. */
    model: string | null,
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
      deckTheme?: { id: string; source: string } | null;
      searchSettings?: {
        searchProvider?: string | null;
        searchApiKey?: string | null;
        searchInstanceUrl?: string | null;
        searchCredentialProviderId?: string | null;
      };
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
      /**
       * This client has a live webview and can execute browser tools.
       *
       * Client-declared because only the renderer knows: Code's preview panel
       * can be closed, and the server builds `onBrowserToolUse` for every
       * surface regardless. Registering tools nothing can run is DR-21's
       * infinite loop.
       */
      browserToolsAvailable?: boolean;
      contextBusEvents?: Array<{ summary: string; source: string; priority: string }>
      capability?: string
      tier?: string
      providerConfig?: { providerId: string; transport?: string; baseUrl?: string }
    }
  ) => Promise<void>;
  abort: () => void;
}


export function useSSEStream(options: UseSSEStreamOptions): UseSSEStreamReturn {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Keep a ref to the chatId that the current stream was started for,
  // so we can abort the correct stream even after conversation switches.
  const activeChatIdRef = useRef<string | null>(null);

  /*
   * One timer PER CHAT.
   *
   * Hoisted to hook level to avoid a Turbopack TDZ issue with block-scoped
   * closures — but a single ref meant concurrent streams shared one timer id:
   * B's per-read reset clobbered A's, then B finishing cleared the only one
   * left, and A — whose connection had actually died — sat spinning with no
   * 120s abort at all. Keyed by chat, so each stream can only ever cancel its
   * own.
   */
  const inactivityTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /**
   * The chats THIS hook has in flight.
   *
   * `isStreaming` is per-surface state, but `streamRegistry` is a module global
   * keyed by chatId across every surface — so gating the flag on
   * `streamRegistry.any()` meant a long Cowork turn kept Chat's composer
   * disabled and its Stop button showing until the app was reloaded, and vice
   * versa. This set answers the question the flag is actually asking.
   */
  const ownStreamsRef = useRef<Set<string>>(new Set());

  const abort = useCallback(() => {
    /*
     * The VISIBLE chat, not the last one to start.
     *
     * This used to resolve through `activeChatIdRef`, which whichever stream
     * started most recently had overwritten. That was safe only while one
     * stream could exist; since conversations were allowed to run concurrently
     * it means: chat A is streaming, you open B and send, you switch back to A
     * and press Stop — and B dies while A keeps going. B is even tagged as a
     * deliberate 'user' cancel, so it finalises silently with no error shown.
     */
    const id = optionsRef.current.chatId || activeChatIdRef.current;
    if (!id) return;
    // Deliberate: the user asked for this. The running stream reads the cause
    // off its signal and finalises the turn without reporting an error.
    streamRegistry.abort(id, 'user');
    if (activeChatIdRef.current === id) activeChatIdRef.current = null;
    // Only when nothing else is running — another conversation's turn must not
    // have the composer unlocked out from under it.
    ownStreamsRef.current.delete(id);
    // This surface's own streams, not every surface's — see ownStreamsRef.
    if (ownStreamsRef.current.size === 0) optionsRef.current.setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (
      message: string,
      chatId: string,
      surfaceId: string,
      model: string | null,
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
        deckTheme?: { id: string; source: string } | null;
      searchSettings?: {
        searchProvider?: string | null;
        searchApiKey?: string | null;
        searchInstanceUrl?: string | null;
        searchCredentialProviderId?: string | null;
      };
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
        browserToolsAvailable?: boolean;
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

      /** Clear THIS chat's inactivity timer, and only this chat's. */
      const clearInactivityTimer = () => {
        const t = inactivityTimersRef.current.get(chatId);
        if (t !== undefined) clearTimeout(t);
        inactivityTimersRef.current.delete(chatId);
      };
      streamRegistry.set(chatId, controller);
      ownStreamsRef.current.add(chatId);
      activeChatIdRef.current = chatId;

      // Snapshot the callbacks at send time so a conversation switch
      // mid-stream doesn't redirect chunks to the wrong chatId.
      const pinnedOnChunk = optionsRef.current.onChunk;
      const pinnedOnDone = optionsRef.current.onDone;
      const pinnedOnError = optionsRef.current.onError;
      const pinnedOnUsage = optionsRef.current.onUsage;
      const pinnedSetIsStreaming = optionsRef.current.setIsStreaming;

      pinnedSetIsStreaming(true);

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
            // Without this the whole search subsystem is inert: the server only
            // ever saw the env fallback, so a provider configured in Settings
            // never reached the agent loop.
            ...(extra?.searchSettings ? { searchSettings: extra.searchSettings } : {}),
            ...(extra?.deckTheme ? { deckTheme: extra.deckTheme } : {}),
            ...(extra?.sessionControls ? { sessionControls: extra.sessionControls } : {}),
            ...(extra?.toolProfile ? { toolProfile: extra.toolProfile } : {}),
            ...(extra?.browserToolsAvailable ? { browserToolsAvailable: true } : {}),
            ...(extra?.capability ? { capability: extra.capability } : {}),
            ...(extra?.tier ? { tier: extra.tier } : {}),
            ...(extra?.providerConfig ? { providerConfig: extra.providerConfig } : {}),
            // A switched-off connector is NOT denied from here. The server stashes
            // it in `disabledMcpServers`, which `loadProvisionedMcpServers` never
            // reads — so it costs no decrypt, no token refresh and no config
            // rewrite. A deny list sent per request could only ever discard work
            // the server had already paid for.
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
          inactivityTimersRef.current.set(chatId, setTimeout(() => {
            console.warn(
              `[SSE] Inactivity timeout — no data for ${INACTIVITY_TIMEOUT_MS / 1000}s, aborting`
            );
            // Tag the cause: this is a failure to report, not a user cancel.
            controller.abort(new StreamAbortCause('timeout'));
          }, INACTIVITY_TIMEOUT_MS));
        };
        const resetInactivityTimer = () => {
          clearInactivityTimer();
          startInactivityTimer();
        };
        startInactivityTimer();

        while (!done) {
          const result = await reader.read();
          resetInactivityTimer();
          if (result.done) {
            if (buffer.trim()) {
              parseSSELines<SSEEvent>(buffer + '\n', pinnedOnChunk, () => {});
            }
            done = true;
            break;
          }

          buffer += decoder.decode(result.value, { stream: true });
          buffer = parseSSELines<SSEEvent>(
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
          // same path as any other stream error: `onError`, which every surface
          // appends to the transcript as `**Error:** …`. notifyStreamAborted
          // first so message state is finalised even if a surface's onError
          // resolves a different chatId than the one this stream was started for.
          notifyStreamAborted({ chatId, reason: 'timeout' });
          pinnedOnError(new Error(timeoutMessage(abortDetailOf(controller.signal))));
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
        pinnedOnError(err);
      } finally {
        /*
         * The turn is over however it ended, so the text-boundary flag goes with
         * it. `resetTextBoundary` was exported and called from nothing but its
         * own tests, which meant a turn ABORTED between a tool call and the next
         * text block left its chatId marked — and the next turn's first reply
         * opened with a stray blank line. Here rather than on `done` precisely
         * because the aborted path is the one that leaks.
         */
        // Only the stream that still owns the chat may reset shared state: a
        // superseded stream settling late must not delete the live stream's
        // registry entry, drop its inactivity timer, or flip its flag off.
        ownStreamsRef.current.delete(chatId);
        if (streamRegistry.release(chatId, controller)) {
          /*
           * Inside the ownership check, not before it. The turn is over however
           * it ended — but a SUPERSEDED stream settling late would otherwise
           * clear the live stream's paragraph-boundary flag and cost it the
           * blank line after a tool call.
           */
          resetTextBoundary(chatId);
          clearInactivityTimer();
          // Only surrender the abort target if it is still pointing at us.
          if (activeChatIdRef.current === chatId) activeChatIdRef.current = null;
          // `isStreaming` is one boolean for the whole surface and it gates the
          // composer, so the FIRST concurrent stream to finish used to unlock it
          // while another was still running — turning a live turn's Stop button
          // back into Send.
          if (ownStreamsRef.current.size === 0) pinnedSetIsStreaming(false);
        }
      }
    },
    []
  );

  return { sendMessage, abort };
}
