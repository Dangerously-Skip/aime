"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MessageList } from "@/components/shared/message-list";
import { ModelSelector } from "@/components/shared/model-selector";
import { ChatTitleBar } from "@/components/shared/chat-title-bar";
import { useChatStore } from "@/stores/chat-store";
import { useConversationStore, isUntitled } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream, stripMessagesForHistory, turnErrorOf } from "@/hooks/use-sse-stream";
import { handleAgnosticChunk } from "@/lib/sse/agnostic-chunks";
import { handleCoreChunk } from "@/lib/sse/core-chunks";
import { streamRegistry } from "@/lib/stream-registry";
import { FileText, FilePen, PanelRight, PanelRightClose, LayoutDashboard, Pencil, Sparkles, Code2, Lightbulb } from "lucide-react";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { Composer, type ComposerHandle } from "@/components/shared/composer/composer";
import { addComposerAttachment, setComposerText } from "@/components/shared/composer/draft-store";
import { lastUserPrompt } from "@/components/shared/composer/recall";
import { rememberTurnAttachments, resendPayload } from "@/components/shared/composer/turn-attachments";
import type { Message } from "@/stores/chat-store";
import { useProjectContext } from "@/hooks/use-project-context";
import { useFileDrop } from "@/hooks/use-file-drop";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { useMemoryStore } from "@/stores/memory-store";
import { formatMemoriesForPrompt } from "@/lib/memory/retriever";
import { summarizeConversation } from "@/lib/memory/summarizer";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
import { ArtifactPanel } from "@/components/shared/artifact-panel";
import type { ParsedArtifact } from "@/lib/artifacts/parser";
import { useElectron } from "@/hooks/use-electron";
import { parseSlashCommand, applySlashCommand, isSessionCommand, DEFAULT_SESSION_CONTROLS } from "@/lib/slash-commands";
import { useModelReady } from "@/hooks/use-model-ready";
import { NoModelCard } from "@/components/shared/no-model-card";
import type { SessionControls } from "@/lib/slash-commands";
import { useCanvasStore } from "@/stores/canvas-store";
import { CanvasOverlay } from "@/components/shared/canvas-overlay";
import { useCanvasSseHandler } from "@/hooks/use-canvas-sse-handler";
import type { CanvasArtifact } from "@/stores/chat-store";
import { FilePreviewSheet } from "@/components/shared/file-preview-sheet";
import { categorizeToolCall, isValidSidebarEntry } from "@/lib/artifact-tracker";
import { artifactsOf } from "./artifacts-of";
import { sendFeatureAdoptionEvent } from "@/lib/telemetry/events";
import { useProviderStore } from "@/stores/provider-store";
import { resolveSendRoute } from "@/lib/models/client-options";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useTurnWiring } from "@/hooks/use-turn-wiring";
import { useBuiltinAccess } from "@/hooks/use-builtin-access";
import { useDocumentPrint } from "@/hooks/use-document-print";
import { useDeckTheme } from "@/hooks/use-deck-theme";
import { useSearchSettings } from "@/hooks/use-search-settings";
import { useScheduledPrompt } from "@/hooks/use-scheduled-prompt";

/** This surface's routing capability — a fixed property of the surface. */
const CAPABILITY = getSurfaceRoute("chat").capability;

const EMPTY_SUGGESTIONS: string[] = [];

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_CANVAS_ARTIFACTS: CanvasArtifact[] = [];

/** Truncate text at the nearest word boundary before maxLen. */
function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.substring(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.5 ? truncated.substring(0, lastSpace) : truncated;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function ChatSurface() {
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ParsedArtifact | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  // Cron jobs now route to standing orders via useAssistantStore (see cron_create handler)
  // Artifact tracking — files created by Write/Edit/Bash tool calls
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  // Dropped files join the draft of the conversation on screen — the same
  // place the composer's own attach button and paste put them.
  const { isDragging, dropZoneProps } = useFileDrop(
    useCallback(
      (file: AttachmentFile) => addComposerAttachment("chat", useChatStore.getState().currentChatId ?? "", file),
      [],
    )
  );
  const currentChatId = useChatStore((s) => s.currentChatId);
  const chatId = currentChatId ?? "";
  // Canvas SSE handler + persisted per-chat canvas artifacts now live in chat-store.
  const onCanvasEvent = useCanvasSseHandler('chat', chatId);
  const canvasArtifacts = useChatStore((s) => (chatId ? s.canvasArtifacts[chatId] : undefined) ?? EMPTY_CANVAS_ARTIFACTS);
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const setCanvasOpen = useCanvasStore((s) => s.setOpen);
  // Local: collapse/expand the right Artifacts column
  const [artifactsSidebarOpen, setArtifactsSidebarOpen] = useState(true);

  const messages = useChatStore(
    (s) =>
      (s.currentChatId ? s.messages[s.currentChatId] : undefined) ??
      EMPTY_MESSAGES
  );

  /*
   * Read back from the transcript rather than accumulated as the stream runs.
   *
   * Accumulating meant the panel was correct only for the turn you were watching:
   * switching conversations cleared it, reloading the app cleared it, and a
   * conversation whose deck was three messages up showed "Artifacts 0". The
   * messages carry the tool calls and are persisted, so there was never anything
   * to accumulate.
   */
  const artifactFiles = useMemo(() => artifactsOf(messages), [messages]);
  const modelRoute = useChatStore((s) => s.modelRoute);
  // THIS conversation's turn, not the surface's: another chat streaming must
  // neither lock this composer nor give it a Stop button that aborts nothing.
  const isStreaming = useChatStore((s) => !!chatId && !!s.streamingChats[chatId]);
  const setChatStreaming = useChatStore((s) => s.setChatStreaming);
  const setModelRoute = useChatStore((s) => s.setModelRoute);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendToLastAssistant = useChatStore(
    (s) => s.appendToLastAssistant
  );
  const addToolCall = useChatStore((s) => s.addToolCall);
  const setTurnError = useChatStore((s) => s.setTurnError);
  const setRetryStatus = useChatStore((s) => s.setRetryStatus);
  const completeRunningTools = useChatStore((s) => s.completeRunningTools);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const updateToolResult = useChatStore((s) => s.updateToolResult);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const setCurrentChat = useChatStore((s) => s.setCurrentChat);
  const setIsStreaming = useChatStore((s) => s.setIsStreaming);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const truncateMessages = useChatStore((s) => s.truncateMessages);
  const updateConversation = useConversationStore(
    (s) => s.updateConversation
  );
  const addConversation = useConversationStore(
    (s) => s.addConversation
  );
  const removeConversation = useConversationStore(
    (s) => s.removeConversation
  );
  const conversations = useConversationStore((s) => s.conversations);
  const activeConvId = useConversationStore((s) => s.activeId);
  const allConversations = useConversationStore((s) => s.conversations);
  const setActiveConversation = useConversationStore(
    (s) => s.setActiveConversation
  );
  const displayName = useSettingsStore((s) => s.displayName);
  const printDocument = useDocumentPrint();
  const personalPreferences = useSettingsStore((s) => s.personalPreferences);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  /**
   * The settings half of a turn, which Chat alone was not sending.
   *
   * Cowork and Code sent all three; Chat sent none, so on this surface a chosen
   * deck theme never reached the model (every deck came back as an unstyled
   * pptx, because the format steering is gated on a theme being set) and search
   * resolved to `none`. The server log said so plainly once it was asked:
   *
   *   [Claude] No deck theme on this request — pptx stays available…
   *   [Claude] aime tools: icloud=yes search=none
   *
   * Same shape as the cowork auto-continue drift: a second place that builds
   * the request and fell behind the first.
   */
  const deckTheme = useDeckTheme(chatId);
  const searchSettings = useSearchSettings();
  const blockDangerousCommands = useSettingsStore((s) => s.blockDangerousCommands);
  const blockNetworkCommands = useSettingsStore((s) => s.blockNetworkCommands);
  const restrictToProjectFolder = useSettingsStore((s) => s.restrictToProjectFolder);
  const disableBashTool = useSettingsStore((s) => s.disableBashTool);
  // Built-in (Claude) reachability, which is the user's key OR the server's env
  // key OR Bedrock — `anthropicApiKey` alone only knows about the first.
  const { hasAnthropicKey, hasBedrock, known: builtinAccessKnown } = useBuiltinAccess();
  const toolProfile = useSettingsStore((s) => s.toolProfile);
  const tierModels = useSettingsStore((s) => s.tierModels);
  const providers = useProviderStore((s) => s.providers);
  const setSessionControlsInStore = useChatStore((s) => s.setSessionControls);
  const addSuggestion = useChatStore((s) => s.addSuggestion);
  const clearSuggestions = useChatStore((s) => s.clearSuggestions);
  const suggestions = useChatStore((s) => chatId ? (s.suggestions[chatId] ?? EMPTY_SUGGESTIONS) : EMPTY_SUGGESTIONS);
  const sessionControlsMap = useChatStore((s) => s.sessionControls);
  const sessionControls: SessionControls = chatId
    ? (sessionControlsMap[chatId] ?? DEFAULT_SESSION_CONTROLS)
    : DEFAULT_SESSION_CONTROLS;
  const { projectInstructions, projectKnowledge, projectName, projectIcon, projectId: currentProjectId, crossSurfaceContext, projectFolder } = useProjectContext(chatId, "chat");
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const navigateToProject = useAppStore((s) => s.navigateToProject);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);

  const { showNotification } = useElectron();
  const isEmpty = messages.length === 0;
  const currentConversation = conversations.find((c) => c.id === chatId);
  const chatTitle = currentConversation?.title || "New conversation";

  useEffect(() => {
    if (!activeConvId) return;
    const conv = allConversations.find((c) => c.id === activeConvId);
    if (conv?.surface === "chat") setCurrentChat(activeConvId);
  }, [activeConvId, allConversations, setCurrentChat]);

  // Episodic memory: summarize previous conversation when switching.
  // Also abort any running stream for the old conversation to prevent spillover.
  const prevChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevChatIdRef.current;
    prevChatIdRef.current = chatId || null;
    if (prevId && prevId !== chatId) {
      /*
       * Deliberately NOT aborting the previous conversation's stream.
       *
       * It used to, "so its chunks don't land in the new conversation" — a real
       * concern, already solved somewhere else: `useSSEStream` pins its
       * callbacks at stream start, so output goes to the chat the stream was
       * STARTED for regardless of what is on screen, and
       * `chat-surface.stream.test.tsx` has asserted that for a while.
       *
       * With the spillover handled, the abort only did harm: opening or
       * switching to another chat killed a turn that was still working, and a
       * long research run could not be left to finish while you did something
       * else. Concurrent conversations are the point of a registry keyed by
       * chatId.
       */
      const prevMessages = useChatStore.getState().messages[prevId];
      if (prevMessages && prevMessages.length > 0) {
        summarizeConversation(prevId, prevMessages);
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ref-guarded conversation switch; the preview is a transient panel, not something the new conversation can derive
      setPreviewPath(null);
    }
  }, [chatId]);

  const ownsChat = useCallback(
    (id: string) => !!useChatStore.getState().messages[id]?.length,
    [],
  );
  // Run recording + the two card-answer persisters, shared with the other three
  // surfaces (see use-turn-wiring for why it is not inlined here any more).
  const { runRecorder, onQuestionAnswered, onConnectorSettled } = useTurnWiring({
    surfaceId: "chat",
    chatId,
    ownsChat,
    updateMessage,
  });

  const { sendMessage, abort } = useSSEStream({
    chatId,
    setIsStreaming,
    setChatStreaming,
    coalesceText: true,
    onUsage: runRecorder.onUsage,
    // `cid` is the chat this stream was started for — never the one on screen
    // now. See useSSEStream for why every callback is handed it.
    onChunk(event, cid) {
      // Chunks whose handling is the same on every surface — cron jobs,
      // standing orders, widgets, memory. Handled in ONE place
      // (lib/sse/agnostic-chunks) because each surface having its own case
      // meant three of them were silently dropped on most surfaces.
      if (handleAgnosticChunk(event, { chatId: cid, surface: 'Chat' })) return;

      // The six chunks whose handling is identical on chat, cowork and code —
      // recorded once in lib/sse/core-chunks against the nine-action store
      // contract all three already satisfied. Chat's one genuine difference (it
      // files an artifact against the project) is the callback below, which makes
      // that difference visible instead of buried in a near-identical switch.
      if (
        handleCoreChunk(event, {
          chatId: cid,
          store: { addMessage, appendToLastAssistant, addToolCall, updateToolResult, completeRunningTools, setTurnError, setRetryStatus },
          printDocument,
          onCanvas: onCanvasEvent,
          notify: (title, body) => {
            if (!document.hasFocus()) showNotification(title, body);
          },
          onToolStarted: (_toolId, toolName, toolInput) => {
            const categorized = categorizeToolCall(toolName, toolInput);
            if (categorized?.category !== "artifact" || !isValidSidebarEntry(categorized.path)) return;
            // The panel derives itself from the transcript (see `artifactFiles`);
            // this callback exists only for the side effect below.
            if (!currentProjectId) return;
            const fileName = categorized.path.split("/").pop() || categorized.path;
            useProjectStore.getState().addArtifact(currentProjectId, {
              id: crypto.randomUUID(),
              name: fileName,
              path: categorized.path,
              type: "file",
              surface: "chat",
              conversationId: cid,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          },
        })
      ) {
        return;
      }

      switch (event.type) {
        case "prompt_suggestion": {
          const suggestion = event.suggestion as string;
          if (suggestion) {
            addSuggestion(cid, suggestion);
          }
          break;
        }
        case "document_extracted": {
          const extractedText = event.extractedText as string | undefined;
          const docName = event.name as string;
          const did = cid;
          if (extractedText && did) {
            const msgs = useChatStore.getState().messages[did] || [];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].role === 'user') {
                const docBlock = `\n\n<document name="${docName}">\n${extractedText}\n</document>`;
                useChatStore.getState().updateMessageContent(did, msgs[i].id, msgs[i].content + docBlock);
                break;
              }
            }
          }
          break;
        }
      }
    },
    onDone(doneId) {
      runRecorder.succeed();
      completeRunningTools(doneId);
      stopStreaming(doneId);
      if (!document.hasFocus()) {
        showNotification("Task complete", "Claude has finished working on your request.");
      }
    },
    onError(error, errorId) {
      runRecorder.fail(error.message);
      stopStreaming(errorId);
      // A banner on the reply, not text in it — see TurnErrorBanner.
      setTurnError(errorId, turnErrorOf(error));
    },
  });

  /**
   * Run a turn for the user message that is ALREADY last in the transcript:
   * the reply placeholder, the request, the run record.
   *
   * Split from `handleSubmit` so Retry and Edit can use it. Both used to call
   * `handleSubmit` with the old text, which added the question a second time,
   * left the failed reply in place above it, and renamed the chat.
   */
  const startTurn = useCallback(
    async (id: string, trimmed: string, attachments: AttachmentFile[], webSearch = false) => {
      addMessage(id, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isLoading: true,
        isStreaming: true,
      });

      startStreaming(id);

      const currentAttachments = [...attachments];
      const currentWebSearch = webSearch;

      if (currentWebSearch) sendFeatureAdoptionEvent({ feature: 'web_search', surface: 'chat' });
      if (currentAttachments.length > 0) sendFeatureAdoptionEvent({ feature: 'file_attachment', surface: 'chat' });
      if (sessionControls.thinkLevel && sessionControls.thinkLevel !== 'off') sendFeatureAdoptionEvent({ feature: 'extended_thinking', surface: 'chat' });

      // Grab prior messages for history fallback (exclude the user message + assistant placeholder)
      const priorMessages = useChatStore.getState().messages[id] || [];
      const history = stripMessagesForHistory(priorMessages.slice(0, -2));

      // Register conversation with project
      if (currentProjectId) {
        useProjectStore.getState().addConversationToProject(currentProjectId, "chat", id);
      }

      // Retrieve relevant memories
      const relevantMemories = useMemoryStore.getState().getMemoriesForContext({
        projectId: currentProjectId,
        query: trimmed,
      });
      const memoriesStr = formatMemoriesForPrompt(relevantMemories);
      // Touch accessed memories
      relevantMemories.forEach((m) => useMemoryStore.getState().touchMemory(m.id));

      // Clear prompt suggestions when a new turn starts
      clearSuggestions(id);

      // A tier route resolves here (it can land on a user provider's model); a
      // pinned model passes through. Null ⇒ nothing resolved, so fall back to
      // the surface's built-in model rather than send an empty one.
      const route = resolveSendRoute(modelRoute, providers, {
        capability: CAPABILITY,
        tierModels,
        hasAnthropicKey,
        hasBedrock,
        known: builtinAccessKnown,
      });

      // Open the run record before the turn starts so an immediate failure is
      // still attributed rather than lost.
      runRecorder.begin({ trigger: "chat", model: route?.model ?? undefined });
      await sendMessage(trimmed, id, "chat", route?.model ?? null, {
        personalPreferences: personalPreferences || undefined,
        displayName: displayName || undefined,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        webSearch: currentWebSearch || undefined,
        projectInstructions: projectInstructions || undefined,
        projectKnowledge: projectKnowledge || undefined,
        apiKey: anthropicApiKey || undefined,
        history: history.length > 0 ? history : undefined,
        memories: memoriesStr || undefined,
        crossSurfaceContext: crossSurfaceContext || undefined,
        sessionControls: sessionControls,
        toolProfile: toolProfile,
        providerConfig: route?.providerConfig,
        securitySettings: {
          blockDangerousCommands,
          blockNetworkCommands,
          restrictToProjectFolder,
          disableBashTool,
        },
        searchSettings,
        deckTheme,
      });
    },
    [
      runRecorder,
      modelRoute,
      providers,
      tierModels,
      anthropicApiKey,
      hasAnthropicKey,
      hasBedrock,
      builtinAccessKnown,
      addMessage,
      startStreaming,
      sendMessage,
      personalPreferences,
      displayName,
      projectInstructions,
      projectKnowledge,
      // Read inside the callback and previously missing, so a slash command or a
      // project change did not take effect until some other dep changed. All
      // are primitives or stable store references, so adding them only affects
      // this callback's identity — it is never used in an effect.
      sessionControls,
      clearSuggestions,
      currentProjectId,
      crossSurfaceContext,
      toolProfile,
      // Read inside the callback. Omitting them means a theme change, a search
      // provider change or a security toggle does not take effect until some
      // OTHER dependency happens to change — the stale-closure bug the cowork
      // dep list already records.
      deckTheme,
      searchSettings,
      blockDangerousCommands,
      blockNetworkCommands,
      restrictToProjectFolder,
      disableBashTool,
    ]
  );

  /** Record a new question: its preview in the sidebar, and a title if the chat has none yet. */
  const touchConversation = useCallback(
    (id: string, text: string) => {
      const conv = useConversationStore.getState().conversations.find((c) => c.id === id);
      updateConversation(id, {
        ...(isUntitled(conv?.title) ? { title: truncateAtWordBoundary(text, 50) } : {}),
        lastMessage: text,
      });
    },
    [updateConversation],
  );

  const handleSubmit = useCallback(
    async (text: string, opts?: { attachments?: AttachmentFile[] }) => {
      if (!text.trim()) return;
      const trimmed = text.trim();
      const attachments = opts?.attachments ?? [];

      // ── Slash command interception ─────────────────────────────────────
      const parsed = parseSlashCommand(trimmed);
      if (parsed) {
        const result = applySlashCommand(parsed, sessionControls);
        if (result) {
          // Apply the new controls
          const currentId = chatId || crypto.randomUUID();
          setSessionControlsInStore(currentId, result.controls);
          // Add a system-like assistant message showing the result
          let id = chatId;
          if (!id) {
            id = currentId;
            addConversation({
              id,
              title: trimmed.substring(0, 50),
              surface: "chat",
              lastMessage: trimmed,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            setActiveConversation(id);
            setCurrentChat(id);
          }
          // Shown, never sent to the model: see stripMessagesForHistory.
          addMessage(id, { id: crypto.randomUUID(), role: "user", content: trimmed, timestamp: Date.now(), isCommandEcho: true });
          addMessage(id, { id: crypto.randomUUID(), role: "assistant", content: result.message, timestamp: Date.now(), isCommandEcho: true });
          return;
        }
      }

      // Auto-create conversation if none active
      let id = chatId;
      if (!id) {
        id = crypto.randomUUID();
        addConversation({
          id,
          title: truncateAtWordBoundary(trimmed, 50),
          surface: "chat",
          lastMessage: trimmed,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        setActiveConversation(id);
        setCurrentChat(id);
      }

      const userMessageId = crypto.randomUUID();
      rememberTurnAttachments(userMessageId, attachments);
      addMessage(id, {
        id: userMessageId,
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
        attachments: attachments.length > 0 ? attachments.map(a => ({ name: a.name, content: '', type: a.type, category: a.category as 'image' | 'document' | 'text' })) : undefined,
      });
      touchConversation(id, trimmed);

      // Web search is a per-message switch: it applies to this send only.
      const webSearch = webSearchEnabled;
      setWebSearchEnabled(false);
      await startTurn(id, trimmed, attachments, webSearch);
    },
    [
      chatId,
      addMessage,
      addConversation,
      setActiveConversation,
      setCurrentChat,
      webSearchEnabled,
      sessionControls,
      setSessionControlsInStore,
      touchConversation,
      startTurn,
    ]
  );

  /*
   * A due cron job runs HERE, through this surface's own submit — not through a
   * scheduler with a send path of its own, which would be a fourth place that
   * starts a turn. Before this, a job published to the bus, switched surface,
   * and nothing ran it.
   */
  useScheduledPrompt('chat', handleSubmit, () => {
    // Busy means the conversation the job would run in is mid-turn — a turn
    // elsewhere does not block it, since conversations run concurrently.
    const st = useChatStore.getState();
    return !!st.currentChatId && !!st.streamingChats[st.currentChatId];
  });

  /**
   * Regenerate the last reply: drop it (and anything after it) and run the
   * same question again, with its attachments — without adding the question a
   * second time or renaming the chat.
   */
  const handleRetry = useCallback(() => {
    if (!chatId || isStreaming) return;
    const msgs = useChatStore.getState().messages[chatId] ?? [];
    const lastUser = msgs.findLast((m) => m.role === "user" && !m.isAutoContinue);
    if (!lastUser) return;
    const { text, attachments } = resendPayload(lastUser);
    truncateMessages(chatId, lastUser.id);
    void startTurn(chatId, text, attachments);
  }, [chatId, isStreaming, truncateMessages, startTurn]);

  /**
   * Edit a question and ask it again: everything from that question on is
   * replaced by the edited question and a fresh reply.
   */
  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      const trimmed = newText.trim();
      if (!chatId || isStreaming || !trimmed) return;
      const msgs = useChatStore.getState().messages[chatId] ?? [];
      const original = msgs.find((m) => m.id === messageId && m.role === "user");
      if (!original) return;
      const { text, attachments } = resendPayload(original, trimmed);
      truncateMessages(chatId, messageId, { inclusive: true });
      const userMessageId = crypto.randomUUID();
      rememberTurnAttachments(userMessageId, attachments);
      addMessage(chatId, {
        id: userMessageId,
        role: "user",
        content: text,
        timestamp: Date.now(),
        attachments: original.attachments,
      });
      touchConversation(chatId, trimmed);
      void startTurn(chatId, text, attachments);
    },
    [chatId, isStreaming, truncateMessages, addMessage, touchConversation, startTurn],
  );

  /*
   * Nothing configured could answer, so say that instead of sending a turn that
   * can only come back as an authentication error. Session commands are
   * client-side and still work.
   */
  const modelReady = useModelReady(modelRoute, CAPABILITY);
  const [noModelAttempted, setNoModelAttempted] = useState(false);
  const submitFromComposer = useCallback(
    (text: string, attachments: AttachmentFile[]) => {
      if (!modelReady && !isSessionCommand(text)) {
        setNoModelAttempted(true);
        return false;
      }
      void handleSubmit(text, { attachments });
    },
    [handleSubmit, modelReady],
  );
  const noModelCard = modelReady ? undefined : <NoModelCard attempted={noModelAttempted} />;

  /** Up-arrow brings back the last thing you asked in THIS conversation. */
  const recallText = useMemo(() => lastUserPrompt(messages), [messages]);

  const attachmentMenu = {
    onWebSearchToggle: () => setWebSearchEnabled((prev) => !prev),
    webSearchEnabled,
    currentProjectId,
    onAddToProject: (pid: string) => assignToProject(chatId, pid),
    onNewProject: () => setSidebarMode("projects"),
    projects: allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon })),
  };

  const modelSelector = (
    <ModelSelector
      value={modelRoute?.id ?? ''}
      onSelectModel={setModelRoute}
      capability={CAPABILITY}
      className="border-0 bg-transparent shadow-none h-6 w-auto text-muted-foreground"
    />
  );

  const handleArtifactSaved = useCallback(
    (artifactId: string, filePath: string) => {
      if (!currentProjectId) return;
      useProjectStore.getState().updateArtifact(currentProjectId, artifactId, {
        path: filePath,
      });
    },
    [currentProjectId]
  );

  const handleArtifactClick = useCallback(
    (pathOrArtifact: string | ParsedArtifact) => {
      if (typeof pathOrArtifact === "string") return; // file path clicks handled elsewhere
      const artifact = pathOrArtifact;
      setActiveArtifact(artifact);

      // Auto-register to project if one is active
      if (currentProjectId) {
        useProjectStore.getState().addArtifact(currentProjectId, {
          id: artifact.id,
          name: artifact.title,
          path: `chat-artifact://${artifact.id}`,
          type: "document",
          surface: "chat",
          conversationId: chatId,
          description: `${artifact.type} artifact from chat`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    },
    [currentProjectId, chatId]
  );

  function handleDeleteChat() {
    removeConversation(chatId);
    clearMessages(chatId);
    setActiveConversation(null);
  }

  function handleRenameChat(newTitle: string) {
    updateConversation(chatId, { title: newTitle });
  }

  return (
    <div className="relative flex h-full flex-col bg-background" {...dropZoneProps}>
      <DropOverlay visible={isDragging} />
      {/* ── Empty state: centered greeting + input ── */}
      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 animate-in fade-in duration-300">
          {/* Greeting */}
          <div className="flex items-center gap-3 mb-8">
            <img src="/starburst-logo.png" alt="" width={32} height={32} />
            <h1 className="text-3xl font-light text-foreground tracking-tight">
              {getGreeting()}{displayName ? `, ${displayName}` : ""}
            </h1>
          </div>

          {/* Centered input card */}
          <div className="w-full max-w-2xl">
            <Composer
              ref={composerRef}
              surface="chat"
              conversationId={chatId}
              variant="hero"
              placeholder="How can I help you today?"
              onSubmit={submitFromComposer}
              isStreaming={isStreaming}
              onStop={abort}
              recallText={recallText}
              attachmentMenu={attachmentMenu}
              toolbarEnd={modelSelector}
              header={noModelCard}
            />

            {/* Quick-start suggestion pills */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              {[
                { label: "Write", icon: Pencil, prompt: "Help me write " },
                { label: "Learn", icon: Sparkles, prompt: "Explain to me " },
                { label: "Code", icon: Code2, prompt: "Write code that " },
                { label: "Brainstorm", icon: Lightbulb, prompt: "Brainstorm ideas for " },
              ].map((pill) => (
                <button
                  key={pill.label}
                  onClick={() => { setComposerText("chat", chatId, pill.prompt); composerRef.current?.focus(); }}
                  className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-card hover:border-border transition-colors"
                >
                  <pill.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{pill.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ── Active conversation: title + messages + artifacts sidebar ── */
        <>
          {/* Title bar */}
          <ChatTitleBar
            title={chatTitle}
            onRename={handleRenameChat}
            onDelete={handleDeleteChat}
            projectName={projectName}
            projectIcon={projectIcon}
            onProjectClick={currentProjectId ? () => navigateToProject(currentProjectId) : undefined}
          />

          {/* Continue in Surface handoff (when project is active) */}
          {currentProjectId && !isStreaming && messages.length > 0 && (
            <div className="flex items-center gap-2 px-6 py-1.5 border-b border-border/50">
              <span className="text-xs text-muted-foreground">Continue in:</span>
              <ContinueInSurface
                currentSurface="chat"
                projectId={currentProjectId}
                conversationId={chatId}
              />
            </div>
          )}

          <div className="relative flex flex-1 min-h-0 overflow-hidden">
            {/* Messages column */}
            <div className="flex flex-1 flex-col min-w-0">
              {/* Messages */}
              <MessageList messages={messages} conversationId={chatId} surfaceId="chat" onArtifactClick={handleArtifactClick} onQuestionAnswered={onQuestionAnswered} onConnectorSettled={onConnectorSettled} onRetry={handleRetry} onEditMessage={isStreaming ? undefined : handleEditMessage} showReasoning={sessionControls.reasoningVisible} expandToolCalls={sessionControls.verboseMode} onCancel={chatId ? () => streamRegistry.abort(chatId) : undefined} />

              {/* Prompt suggestions */}
              {suggestions.length > 0 && !isStreaming && (
                <div className="px-6 pb-1">
                  <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => { setComposerText("chat", chatId, s); composerRef.current?.focus(); }}
                        className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Bottom input card */}
              <div className="px-6 pb-4 pt-2">
                <div className="max-w-3xl mx-auto">
                  <Composer
                    ref={composerRef}
                    surface="chat"
                    conversationId={chatId}
                    placeholder="Reply..."
                    onSubmit={submitFromComposer}
                    isStreaming={isStreaming}
                    onStop={abort}
                    recallText={recallText}
                    attachmentMenu={attachmentMenu}
                    toolbarEnd={modelSelector}
                    header={noModelCard}
                  />
                </div>
              </div>
            </div>

            {/* Artifacts sidebar — collapsible. When collapsed, a 40px-wide
                strip with just an expand button so canvases stay findable. */}
            <div className={`shrink-0 p-2 flex flex-col transition-all duration-200 ${artifactsSidebarOpen ? 'w-64' : 'w-12'}`}>
              {!artifactsSidebarOpen ? (
                <button
                  type="button"
                  onClick={() => setArtifactsSidebarOpen(true)}
                  className="flex items-center justify-center py-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  title="Show artifacts"
                >
                  <PanelRight className="h-4 w-4" />
                </button>
              ) : (
                /*
                  ONE card, header and list together — the shape Cowork's
                  Artifacts card already has. These were two sibling
                  conditionals, so making the RAIL the well produced a slab with
                  a header floating in it rather than a card sitting in a rail.
                */
                <div className="surface-well flex flex-1 min-h-0 flex-col">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <FilePen className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Artifacts</span>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">{artifactFiles.length + canvasArtifacts.length}</span>
                  <button
                    type="button"
                    onClick={() => setArtifactsSidebarOpen(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Hide artifacts"
                  >
                    <PanelRightClose className="h-3.5 w-3.5" />
                  </button>
                </div>
              <div className="flex-1 overflow-auto p-1.5 space-y-0.5">
                {canvasArtifacts.length === 0 && artifactFiles.length === 0 && (
                  <div className="text-[11px] text-muted-foreground px-2.5 py-3 text-center leading-relaxed">
                    Canvases and files the agent produces in this chat will appear here. Click any item to reopen it.
                  </div>
                )}
                {canvasArtifacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { pushCanvas('chat', c.doc, chatId || null); setCanvasOpen('chat', true); }}
                    className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-left hover:bg-muted transition-colors group"
                    title={c.title}
                  >
                    <LayoutDashboard className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate text-foreground/80 group-hover:text-foreground">{c.title}</span>
                  </button>
                ))}
                {artifactFiles.map((filePath: string) => {
                  const name = filePath.split("/").pop() || filePath;
                  return (
                    <button
                      key={filePath}
                      onClick={() => setPreviewPath(filePath)}
                      className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-left hover:bg-muted transition-colors group"
                      title={filePath}
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate text-foreground/80 group-hover:text-foreground">{name}</span>
                    </button>
                  );
                })}
              </div>
                </div>
              )}
            </div>

            {/* Canvas overlay — slides in over the chat content */}
            <CanvasOverlay surfaceId="chat" conversationId={chatId} />
          </div>
        </>
      )}

      {/* Inline artifact preview (:::artifact blocks from markdown) */}
      <ArtifactPanel
        artifact={activeArtifact}
        open={activeArtifact !== null}
        onClose={() => setActiveArtifact(null)}
        projectFolder={projectFolder}
        conversationId={chatId}
        projectId={currentProjectId}
        onArtifactSaved={handleArtifactSaved}
      />

      {/* File artifact preview sheet */}
      <FilePreviewSheet
        path={previewPath}
        open={!!previewPath}
        onClose={() => setPreviewPath(null)}
      />
    </div>
  );
}
