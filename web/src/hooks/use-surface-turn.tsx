'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConversationStore, isUntitled } from '@/stores/conversation-store';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Message } from '@/stores/chat-store';
import type { TranscriptSlice } from '@/stores/slices/transcript-slice';
import {
  useSSEStream,
  stripMessagesForHistory,
  turnErrorOf,
  type SendExtra,
  type SSEEvent,
  type StreamUsage,
} from '@/hooks/use-sse-stream';
import { useTurnWiring } from '@/hooks/use-turn-wiring';
import { useBuiltinAccess } from '@/hooks/use-builtin-access';
import { useModelReady } from '@/hooks/use-model-ready';
import { useDocumentPrint } from '@/hooks/use-document-print';
import { useElectron } from '@/hooks/use-electron';
import { useScheduledPrompt } from '@/hooks/use-scheduled-prompt';
import { useHandoffTurn } from '@/hooks/use-handoff-turn';
import { handleAgnosticChunk } from '@/lib/sse/agnostic-chunks';
import { handleCoreChunk, type CoreChunkContext } from '@/lib/sse/core-chunks';
import { resolveSendRoute, type ModelOption } from '@/lib/models/client-options';
import type { ClientRoute } from '@/lib/models/effective-registry';
import type { Capability } from '@/lib/models/types';
import type { RunTrigger } from '@/lib/runs/types';
import { summarizeConversation } from '@/lib/memory/summarizer';
import { sendFeatureAdoptionEvent } from '@/lib/telemetry/events';
import {
  parseSlashCommand,
  applySlashCommand,
  isSessionCommand,
  DEFAULT_SESSION_CONTROLS,
  type SessionControls,
} from '@/lib/slash-commands';
import type { AttachmentFile } from '@/components/shared/attachment-menu';
import { lastUserPrompt } from '@/components/shared/composer/recall';
import { rememberTurnAttachments, resendPayload } from '@/components/shared/composer/turn-attachments';
import { NoModelCard } from '@/components/shared/no-model-card';

/**
 * ONE TURN PATH for every conversation surface.
 *
 * Chat, Cowork, Code, Browser and the project page each had their own submit:
 * slash commands, creating the conversation, titling it, opening the run record,
 * resolving the route, refusing when no model could answer, building the
 * request, and the stream callbacks on the way back. Six copies of one flow,
 * and every fix landed in some of them — the typed error banner, per-chat
 * streaming, Retry that regenerates instead of re-asking, the title set once,
 * "Connect a model" — reached Chat and Cowork and nothing else.
 *
 * What stays with a surface is what is genuinely different about it, as named
 * hooks rather than a fork of the flow:
 *
 *  - `request`   what its turn carries (folder, memories, tool profile…)
 *  - `dispatch`  how the turn is sent, when it is not simply sent (Browser's
 *                page questions run a local loop instead)
 *  - `chunks`    stream events beyond the shared ones, and callbacks on the
 *                shared tool events (Cowork's artifact rail, Code's preview)
 *  - `onDone` / `onError` / `onUsage`  what else happens when a turn ends
 */

/** The four surfaces that hold a transcript. The Assistant feed is cards, not turns. */
export type TurnSurfaceId = 'chat' | 'cowork' | 'code' | 'browser';

/** A surface store, narrowed to the transcript every one of them has. */
export interface TurnStore {
  <T>(selector: (state: TranscriptSlice) => T): T;
  getState: () => TranscriptSlice;
}

/** Where a surface keeps each conversation's slash-command settings. */
export interface SessionControlsAccess {
  get: (chatId: string) => SessionControls;
  set: (chatId: string, controls: SessionControls) => void;
}

/** What a surface's request builder is told about the turn. */
export interface TurnInput {
  chatId: string;
  text: string;
  attachments: AttachmentFile[];
  sessionControls: SessionControls;
}

/** A turn ready to send: the route it resolved to and the request built for it. */
export interface PreparedTurn extends TurnInput {
  route: ClientRoute | null;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  extra: SendExtra;
}

/** What a `dispatch` may change when it sends through the shared path. */
export interface SendOverride {
  message?: string;
  /** Replaces the route's model (null = let the server resolve). */
  model?: string | null;
  extra?: Partial<SendExtra>;
}

/** Callbacks on the shared chunk handling — see `CoreChunkContext`. */
export type CoreExtras = Partial<
  Pick<CoreChunkContext, 'normaliseToolInput' | 'onToolStarted' | 'onToolResult' | 'skip' | 'onCanvas'>
>;

/** Run a turn for the user message already last in `chatId`'s transcript. */
export type StartTurn = (
  chatId: string,
  text: string,
  attachments?: AttachmentFile[],
  extra?: Partial<SendExtra>,
  opts?: { trigger?: RunTrigger },
) => Promise<void>;

/** What a surface's `onDone` can use to start a follow-up turn. */
export interface TurnControls {
  startTurn: StartTurn;
}

export interface SurfaceTurnConfig {
  surface: TurnSurfaceId;
  /** Log prefix for the shared chunk handlers, e.g. 'Chat'. */
  label: string;
  store: TurnStore;
  capability: Capability;
  /** The composer's selection; null follows Settings (Browser has no picker). */
  modelRoute: ModelOption | null;
  /** Defaults to per-conversation controls held by this hook. */
  sessionControls?: SessionControlsAccess;
  /** Recorded on the Run of a typed turn. Default 'manual'. */
  trigger?: RunTrigger;
  /**
   * Render a canvas. Required: a canvas nobody handles is this codebase's
   * signature bug — wired, produces nothing, and no way to tell it was tried.
   */
  onCanvas: (event: { doc?: unknown }, chatId: string) => void;
  /** The surface's half of the request — everything but message, model, history and attachments. */
  request?: (turn: TurnInput) => SendExtra | Promise<SendExtra>;
  /** Send the turn some other way, or change what the shared send carries. */
  dispatch?: (turn: PreparedTurn, send: (override?: SendOverride) => Promise<void>) => Promise<void>;
  /** A submit created this conversation (Cowork and Code file a folder picked before it existed). */
  onConversationCreated?: (chatId: string) => void;
  chunks?: {
    /** Before the shared handling; return true to take the event. */
    before?: (event: SSEEvent, chatId: string) => boolean;
    /** Callbacks on the shared tool events, for the chat the stream belongs to. */
    core?: (chatId: string) => CoreExtras;
    /** Whatever the shared handling did not take. */
    after?: (event: SSEEvent, chatId: string) => void;
  };
  onUsage?: (usage: StreamUsage, chatId: string) => void;
  /**
   * After the shared bookkeeping for a finished turn. Return true when the
   * surface is carrying on (an auto-continue), so no "finished" notification.
   */
  onDone?: (chatId: string, turn: TurnControls) => boolean | void;
  onError?: (error: Error, chatId: string) => void;
  /** Summarise a conversation into episodic memory when the user leaves it. */
  summarizeOnLeave?: boolean;
}

const EMPTY_MESSAGES: Message[] = [];

/** Truncate at the nearest word boundary before maxLen. */
export function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.substring(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.5 ? truncated.substring(0, lastSpace) : truncated;
}

/** Per-conversation slash-command settings for a surface whose store has none. */
function useLocalSessionControls(): SessionControlsAccess {
  const ref = useRef<Map<string, SessionControls>>(new Map());
  return useMemo(
    () => ({
      get: (chatId) => ref.current.get(chatId) ?? DEFAULT_SESSION_CONTROLS,
      set: (chatId, controls) => {
        ref.current.set(chatId, controls);
      },
    }),
    [],
  );
}

export function useSurfaceTurn(config: SurfaceTurnConfig) {
  const { surface, store, capability, modelRoute } = config;

  const chatId = store((s) => s.currentChatId) ?? '';
  const messages = store((s) => (s.currentChatId ? s.messages[s.currentChatId] : undefined) ?? EMPTY_MESSAGES);
  // THIS conversation's turn, not the surface's: another chat streaming must
  // neither lock this composer nor give it a Stop button that aborts nothing.
  const isStreaming = store((s) => !!s.currentChatId && !!s.streamingChats[s.currentChatId]);

  const localControls = useLocalSessionControls();

  // ── Follow the conversation the app has open ─────────────────────────────
  const activeId = useConversationStore((s) => s.activeId);
  const activeSurface = useConversationStore(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.surface,
  );
  useEffect(() => {
    if (activeId && activeSurface === surface) store.getState().setCurrentChat(activeId);
  }, [activeId, activeSurface, surface, store]);

  /*
   * Leaving a conversation does NOT abort its stream. It used to, "so its
   * chunks don't land in the new conversation" — but `useSSEStream` pins its
   * callbacks to the chat a stream was started for, so there is no spillover to
   * prevent, and the abort only killed a turn that was still working.
   */
  const prevChatIdRef = useRef<string | null>(null);
  const summarizeOnLeave = !!config.summarizeOnLeave;
  useEffect(() => {
    const prev = prevChatIdRef.current;
    prevChatIdRef.current = chatId || null;
    if (!summarizeOnLeave || !prev || prev === chatId) return;
    const left = store.getState().messages[prev];
    if (left?.length) summarizeConversation(prev, left);
  }, [chatId, store, summarizeOnLeave]);

  // ── Route: the ONE chokepoint ─────────────────────────────────────────────
  const { hasAnthropicKey, hasBedrock, known: builtinAccessKnown } = useBuiltinAccess();
  const tierModels = useSettingsStore((s) => s.tierModels);
  const providers = useProviderStore((s) => s.providers);
  /**
   * A tier route resolves here (it can land on a user provider's model); a
   * pinned model passes through. Null ⇒ nothing resolved, and the server falls
   * back to its own registry rather than being sent an empty model.
   */
  const resolveRoute = useCallback(
    () =>
      resolveSendRoute(modelRoute, providers, {
        capability,
        tierModels,
        hasAnthropicKey,
        hasBedrock,
        known: builtinAccessKnown,
      }),
    [modelRoute, providers, capability, tierModels, hasAnthropicKey, hasBedrock, builtinAccessKnown],
  );

  // ── Runs, cards, relays ───────────────────────────────────────────────────
  const ownsChat = useCallback((id: string) => !!store.getState().messages[id]?.length, [store]);
  const updateMessage = useCallback(
    (id: string, messageId: string, patch: Partial<Message>) => store.getState().updateMessage(id, messageId, patch),
    [store],
  );
  const { runRecorder, onQuestionAnswered, onConnectorSettled } = useTurnWiring({
    surfaceId: surface,
    chatId,
    ownsChat,
    updateMessage,
  });
  const printDocument = useDocumentPrint();
  const { showNotification } = useElectron();
  const notify = useCallback(
    (title: string, body: string) => {
      if (!document.hasFocus()) showNotification(title, body);
    },
    [showNotification],
  );

  /*
   * How a turn ends. Takes the config explicitly: from a stream callback it is
   * the config of the render that SENT the turn (the stream pins its
   * callbacks), so a project or folder change mid-turn does not re-file what
   * that turn produced.
   */
  function finishTurn(cfg: SurfaceTurnConfig, cid: string, turn: TurnControls) {
    runRecorder.succeed(cid);
    const s = store.getState();
    s.completeRunningTools(cid);
    s.stopStreaming(cid);
    const carriesOn = cfg.onDone?.(cid, turn);
    if (!carriesOn) notify('Task complete', 'The assistant has finished working on your request.');
  }

  function failTurnWith(cfg: SurfaceTurnConfig, cid: string, error: Error) {
    runRecorder.fail(error.message, cid);
    const s = store.getState();
    s.completeRunningTools(cid);
    s.stopStreaming(cid);
    // A banner on the reply, never text in it: content goes back to the model
    // as history, and "**Error:** …" then read as something it had said.
    s.setTurnError(cid, turnErrorOf(error));
    cfg.onError?.(error, cid);
  }

  const latest = useRef<{
    config: SurfaceTurnConfig;
    resolveRoute: typeof resolveRoute;
    turn: TurnControls;
  } | null>(null);

  const { sendMessage, abort } = useSSEStream({
    chatId,
    setIsStreaming: store.getState().setIsStreaming,
    setChatStreaming: store.getState().setChatStreaming,
    coalesceText: true,
    // Every callback is handed the chat its stream was started for — never the
    // one on screen now. See useSSEStream for why.
    onUsage(usage, cid) {
      runRecorder.onUsage(usage, cid);
      config.onUsage?.(usage, cid);
    },
    onChunk(event, cid) {
      // Global side effects (cron jobs, standing orders, widgets, memory).
      if (handleAgnosticChunk(event, { chatId: cid, surface: config.label })) return;
      if (config.chunks?.before?.(event, cid)) return;
      const s = store.getState();
      if (
        handleCoreChunk(event, {
          chatId: cid,
          store: {
            addMessage: s.addMessage,
            appendToLastAssistant: s.appendToLastAssistant,
            addToolCall: s.addToolCall,
            updateToolResult: s.updateToolResult,
            completeRunningTools: s.completeRunningTools,
            setTurnError: s.setTurnError,
            setRetryStatus: s.setRetryStatus,
            markSegment: s.markSegment,
            retractSegments: s.retractSegments,
          },
          printDocument,
          onCanvas: (e) => config.onCanvas(e, cid),
          notify,
          ...config.chunks?.core?.(cid),
        })
      ) {
        return;
      }
      config.chunks?.after?.(event, cid);
    },
    onDone(cid) {
      finishTurn(config, cid, latest.current!.turn);
    },
    onError(error, cid) {
      failTurnWith(config, cid, error);
    },
  });

  /**
   * Run a turn for the user message that is ALREADY last in the transcript:
   * the reply placeholder, the run record, the request. Split from `submit`
   * so Retry and Edit reuse it — both used to re-submit the old text, which
   * asked the question a second time under the failed reply and renamed the
   * chat.
   */
  const startTurn: StartTurn = useCallback(
    async (id, text, attachments = [], extra, opts) => {
      const { config: cfg, resolveRoute: resolve } = latest.current!;
      const s = store.getState();
      s.addMessage(id, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isLoading: true,
        isStreaming: true,
      });
      s.startStreaming(id);

      const sessionControls = (cfg.sessionControls ?? localControls).get(id);
      // Everything before the question just added and the reply placeholder.
      const history = stripMessagesForHistory((store.getState().messages[id] ?? []).slice(0, -2));
      const route = resolve();
      if (attachments.length > 0) sendFeatureAdoptionEvent({ feature: 'file_attachment', surface: cfg.surface });
      if (extra?.webSearch) sendFeatureAdoptionEvent({ feature: 'web_search', surface: cfg.surface });
      if (sessionControls.thinkLevel && sessionControls.thinkLevel !== 'off') {
        sendFeatureAdoptionEvent({ feature: 'extended_thinking', surface: cfg.surface });
      }
      if (sessionControls.agentName) sendFeatureAdoptionEvent({ feature: 'agent_routing', surface: cfg.surface });

      // Open the run record before the turn starts, so an immediate failure is
      // still attributed rather than lost.
      runRecorder.begin({ trigger: opts?.trigger ?? cfg.trigger ?? 'manual', model: route?.model ?? undefined, chatId: id });
      try {
        const input: TurnInput = { chatId: id, text, attachments, sessionControls };
        const base = cfg.request ? await cfg.request(input) : {};
        const turn: PreparedTurn = { ...input, route, history, extra: { ...base, ...extra } };
        const send = (override?: SendOverride) =>
          sendMessage(
            override?.message ?? text,
            id,
            cfg.surface,
            override && 'model' in override ? (override.model ?? null) : (route?.model ?? null),
            {
              ...turn.extra,
              providerConfig: route?.providerConfig,
              attachments: attachments.length > 0 ? attachments : undefined,
              history: history.length > 0 ? history : undefined,
              sessionControls,
              ...override?.extra,
            },
          );
        if (cfg.dispatch) await cfg.dispatch(turn, send);
        else await send();
      } catch (err) {
        // Building the request failed before anything was sent — say so on the
        // reply rather than leave it spinning.
        failTurnWith(cfg, id, err instanceof Error ? err : new Error(String(err)));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the latest config through `latest`; failTurnWith only touches stable store actions and the recorder
    [store, sendMessage, runRecorder, localControls],
  );

  /** A new, untitled conversation on this surface, now on screen. */
  const ensureConversation = useCallback((): string => {
    const existing = store.getState().currentChatId;
    if (existing) return existing;
    const id = crypto.randomUUID();
    const now = Date.now();
    const conversations = useConversationStore.getState();
    conversations.addConversation({ id, title: 'New Chat', surface, lastMessage: '', createdAt: now, updatedAt: now });
    conversations.setActiveConversation(id);
    store.getState().setCurrentChat(id);
    latest.current!.config.onConversationCreated?.(id);
    return id;
  }, [store, surface]);

  /** Record a question: its sidebar preview, and a title if the chat has none yet. */
  const touchConversation = useCallback((id: string, text: string) => {
    const conversations = useConversationStore.getState();
    const conv = conversations.conversations.find((c) => c.id === id);
    conversations.updateConversation(id, {
      ...(isUntitled(conv?.title) ? { title: truncateAtWordBoundary(text, 50) } : {}),
      lastMessage: text,
    });
  }, []);

  /**
   * Everything a sent message goes through, typed or scheduled or handed over:
   * a session command runs here and never reaches the model; anything else
   * lands in the conversation on screen (created if there is none) and starts
   * a turn.
   */
  const submit = useCallback(
    async (text: string, attachments: AttachmentFile[] = [], extra?: Partial<SendExtra>): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const cfg = latest.current!.config;
      const access = cfg.sessionControls ?? localControls;
      const s = store.getState();

      const parsed = parseSlashCommand(trimmed);
      if (parsed) {
        const result = applySlashCommand(parsed, access.get(s.currentChatId ?? ''));
        if (result) {
          // A command is not a name: the conversation stays untitled until the
          // first real message.
          const id = ensureConversation();
          access.set(id, result.controls);
          // Shown, never sent to the model: see stripMessagesForHistory.
          s.addMessage(id, { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: Date.now(), isCommandEcho: true });
          s.addMessage(id, { id: crypto.randomUUID(), role: 'assistant', content: result.message, timestamp: Date.now(), isCommandEcho: true });
          return;
        }
      }

      const id = ensureConversation();
      const userMessageId = crypto.randomUUID();
      rememberTurnAttachments(userMessageId, attachments);
      s.addMessage(id, {
        id: userMessageId,
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
        attachments:
          attachments.length > 0
            ? attachments.map((a) => ({ name: a.name, content: '', type: a.type, category: a.category as 'image' | 'document' | 'text' }))
            : undefined,
      });
      touchConversation(id, trimmed);
      await startTurn(id, trimmed, attachments, extra);
    },
    [store, localControls, ensureConversation, touchConversation, startTurn],
  );

  /**
   * Regenerate the last reply: drop it (and anything after it) and run the
   * same question again, with its attachments — no duplicate question, no
   * rename.
   */
  const retry = useCallback(() => {
    const s = store.getState();
    const id = s.currentChatId;
    if (!id || s.streamingChats[id]) return;
    const lastUser = (s.messages[id] ?? []).findLast(
      (m) => m.role === 'user' && !m.isAutoContinue && !m.isCommandEcho,
    );
    if (!lastUser) return;
    const { text, attachments } = resendPayload(lastUser);
    s.truncateMessages(id, lastUser.id);
    void startTurn(id, text, attachments);
  }, [store, startTurn]);

  /** Edit a question and ask again: it and everything after it are replaced. */
  const editMessage = useCallback(
    (messageId: string, newText: string) => {
      const trimmed = newText.trim();
      const s = store.getState();
      const id = s.currentChatId;
      if (!id || s.streamingChats[id] || !trimmed) return;
      const original = (s.messages[id] ?? []).find((m) => m.id === messageId && m.role === 'user');
      if (!original) return;
      const payload = resendPayload(original, trimmed);
      s.truncateMessages(id, messageId, { inclusive: true });
      const userMessageId = crypto.randomUUID();
      rememberTurnAttachments(userMessageId, payload.attachments);
      s.addMessage(id, {
        id: userMessageId,
        role: 'user',
        content: payload.text,
        timestamp: Date.now(),
        attachments: original.attachments,
      });
      touchConversation(id, trimmed);
      void startTurn(id, payload.text, payload.attachments);
    },
    [store, touchConversation, startTurn],
  );

  /** For a turn this surface runs outside the shared send (Browser's page loop). */
  const completeTurn = useCallback(
    (cid: string) => finishTurn(latest.current!.config, cid, latest.current!.turn),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see startTurn
    [],
  );
  const failTurn = useCallback(
    (cid: string, error: Error) => failTurnWith(latest.current!.config, cid, error),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see startTurn
    [],
  );

  useEffect(() => {
    latest.current = { config, resolveRoute, turn: { startTurn } };
  });

  /*
   * A due scheduled job runs through this same submit — not a scheduler with a
   * send path of its own. Busy means the conversation the job would run in is
   * mid-turn: a turn elsewhere does not block it, and running anyway would
   * supersede (silently kill) the turn in progress.
   */
  const isBusy = useCallback(() => {
    const s = store.getState();
    return !!s.currentChatId && !!s.streamingChats[s.currentChatId];
  }, [store]);
  useScheduledPrompt(surface, submit, isBusy);
  // A first message written on the project page, sent from here.
  useHandoffTurn(surface, chatId, submit);

  // ── "Connect a model" instead of a turn that can only fail ────────────────
  const modelReady = useModelReady(modelRoute, capability);
  const [noModelAttempted, setNoModelAttempted] = useState(false);
  /** False (and the card announces itself) when nothing could answer this text. */
  const guardModel = useCallback(
    (text: string): boolean => {
      // Session commands are client-side and need no model.
      if (modelReady || isSessionCommand(text)) return true;
      setNoModelAttempted(true);
      return false;
    },
    [modelReady],
  );
  const noModelCard = modelReady ? null : <NoModelCard attempted={noModelAttempted} />;

  /** The composer's send: refused (draft kept) when no model can answer. */
  const onComposerSubmit = useCallback(
    (text: string, attachments: AttachmentFile[]) => {
      if (!guardModel(text)) return false;
      void submit(text, attachments);
    },
    [guardModel, submit],
  );

  /** Up-arrow brings back the last thing you asked in THIS conversation. */
  const recallText = useMemo(() => lastUserPrompt(messages), [messages]);

  return {
    chatId,
    messages,
    isStreaming,
    submit,
    startTurn,
    retry,
    editMessage,
    abort,
    completeTurn,
    failTurn,
    ensureConversation,
    resolveRoute,
    runRecorder,
    guardModel,
    noModelCard,
    /** Spread into `<Composer>`; a surface overrides what it adds to. */
    composer: {
      surface,
      conversationId: chatId,
      onSubmit: onComposerSubmit,
      isStreaming,
      onStop: abort,
      recallText,
      header: noModelCard,
    },
    /** Spread into `<MessageList>`. */
    transcript: {
      messages,
      conversationId: chatId,
      onRetry: retry,
      onEditMessage: isStreaming ? undefined : editMessage,
      onQuestionAnswered,
      onConnectorSettled,
      onCancel: chatId ? abort : undefined,
    },
  };
}

export type SurfaceTurn = ReturnType<typeof useSurfaceTurn>;
