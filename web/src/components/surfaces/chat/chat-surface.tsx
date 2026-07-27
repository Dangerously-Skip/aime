"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MessageList } from "@/components/shared/message-list";
import { ModelSelector } from "@/components/shared/model-selector";
import { ChatTitleBar } from "@/components/shared/chat-title-bar";
import { useChatStore } from "@/stores/chat-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream, stripMessagesForHistory } from "@/hooks/use-sse-stream";
import { streamRegistry } from "@/lib/stream-registry";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowUp, Square, X, ImageIcon, FileText, File, FilePen, PanelRight, PanelRightClose, LayoutDashboard } from "lucide-react";
import { AttachmentMenu } from "@/components/shared/attachment-menu";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import type { Message } from "@/stores/chat-store";
import { useProjectContext } from "@/hooks/use-project-context";
import { useFileDrop } from "@/hooks/use-file-drop";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { useMemoryStore } from "@/stores/memory-store";
import { formatMemoriesForPrompt } from "@/lib/memory/retriever";
import { handleMemoryExtractEvent } from "@/lib/memory/handle-extract-event";
import { summarizeConversation } from "@/lib/memory/summarizer";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
import { ArtifactPanel } from "@/components/shared/artifact-panel";
import type { ParsedArtifact } from "@/lib/artifacts/parser";
import { useElectron } from "@/hooks/use-electron";
import { VoiceButton } from "@/components/shared/voice-button";
import { parseSlashCommand, applySlashCommand, getSlashSuggestions, DEFAULT_SESSION_CONTROLS } from "@/lib/slash-commands";
import type { SessionControls } from "@/lib/slash-commands";
import { CommandPicker, type CommandSuggestion } from "@/components/shared/command-picker";
import { useAtSuggestions, removeAtQuery } from "@/hooks/use-at-suggestions";
import { useCanvasStore } from "@/stores/canvas-store";
import { CanvasOverlay } from "@/components/shared/canvas-overlay";
import { useCanvasSseHandler } from "@/hooks/use-canvas-sse-handler";
import type { CanvasArtifact } from "@/stores/chat-store";
import { useAssistantStore } from "@/stores/assistant-store";
import { FilePreviewSheet } from "@/components/shared/file-preview-sheet";
import { categorizeToolCall, isValidSidebarEntry, BASH_ARTIFACT_EXT } from "@/lib/artifact-tracker";
import { sendFeatureAdoptionEvent } from "@/lib/telemetry/events";
import { useProviderStore } from "@/stores/provider-store";
import { resolveSendRoute } from "@/lib/models/client-options";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useRunRecorder } from "@/hooks/use-run-recorder";
import { handleWidgetCreateEvent } from "@/lib/widgets/handle-create-event";
import { useToolBudgetStore } from "@/stores/tool-budget-store";
import type { ToolBudgetReport } from "@/lib/mcp/filter";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { useDocumentPrint } from "@/hooks/use-document-print";

/** This surface's routing capability — a fixed property of the surface. */
const CAPABILITY = getSurfaceRoute("chat").capability;

const EMPTY_SUGGESTIONS: string[] = [];

function AttachmentIcon({ category }: { category: AttachmentFile['category'] }) {
  switch (category) {
    case 'image': return <ImageIcon className="h-3 w-3" />
    case 'document': return <File className="h-3 w-3" />
    default: return <FileText className="h-3 w-3" />
  }
}

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
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ParsedArtifact | null>(null);
  const [cmdSuggestions, setCmdSuggestions] = useState<CommandSuggestion[]>([]);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(0);
  const { fileSuggestions, clearAtSuggestions, resolveFileAsAttachment } =
    useAtSuggestions();
  // Cron jobs now route to standing orders via useAssistantStore (see cron_create handler)
  // Artifact tracking — files created by Write/Edit/Bash tool calls
  const [artifactFiles, setArtifactFiles] = useState<string[]>([]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const addArtifactFile = useCallback((path: string) => {
    setArtifactFiles((prev) => prev.includes(path) ? prev : [...prev, path]);
  }, []);
  const { isDragging, dropZoneProps } = useFileDrop(
    useCallback((file: AttachmentFile) => setAttachments((prev) => [...prev, file]), [])
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

  // Clear local artifact state on conversation change. Canvas-store lifecycle
  // is handled by <CanvasOverlay /> via its own useEffect.
  const lastChatIdRef = useRef<string>("");
  useEffect(() => {
    if (!chatId) return;
    if (lastChatIdRef.current === chatId) return;
    lastChatIdRef.current = chatId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ref-guarded, fires only on an actual conversation switch; artifacts accumulate from stream events so they can't be derived
    setArtifactFiles([]);
  }, [chatId]);
  const messages = useChatStore(
    (s) =>
      (s.currentChatId ? s.messages[s.currentChatId] : undefined) ??
      EMPTY_MESSAGES
  );
  const model = useChatStore((s) => s.model);
  const modelRoute = useChatStore((s) => s.modelRoute);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setModel = useChatStore((s) => s.setModel);
  const setModelRoute = useChatStore((s) => s.setModelRoute);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendToLastAssistant = useChatStore(
    (s) => s.appendToLastAssistant
  );
  const addToolCall = useChatStore((s) => s.addToolCall);
  const completeRunningTools = useChatStore((s) => s.completeRunningTools);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const updateToolResult = useChatStore((s) => s.updateToolResult);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const setCurrentChat = useChatStore((s) => s.setCurrentChat);
  const setIsStreaming = useChatStore((s) => s.setIsStreaming);
  const setStreamError = useChatStore((s) => s.setStreamError);
  const clearMessages = useChatStore((s) => s.clearMessages);
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
  const pushToTalkEnabled = useSettingsStore((s) => s.pushToTalkEnabled);
  const printDocument = useDocumentPrint();
  const personalPreferences = useSettingsStore((s) => s.personalPreferences);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
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
      // Abort the old stream so its chunks don't land in the new conversation
      streamRegistry.abort(prevId);
      const prevMessages = useChatStore.getState().messages[prevId];
      if (prevMessages && prevMessages.length > 0) {
        summarizeConversation(prevId, prevMessages);
      }
      // Clear artifact state for the new conversation
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ref-guarded conversation switch; paired with the stream abort + summarize side effects above
      setArtifactFiles([]);
      setPreviewPath(null);
    }
  }, [chatId]);

  // Read the CURRENT chatId from the store at call time, not from the
  // closure. On the first message in a new chat, the closure chatId is ""
  // because setCurrentChat(newId) hasn't triggered a re-render yet.
  // This causes chunks to be written to chatId "" instead of the new ID.
  const getChatId = () => useChatStore.getState().currentChatId ?? "";

  // Records a Run per turn so every execution leaves a durable trace with its
  // cost attached (P6 substrate — see lib/runs).
  const runRecorder = useRunRecorder("chat");

  const { sendMessage, abort } = useSSEStream({
    chatId,
    setIsStreaming,
    setStreamError,
    onUsage: runRecorder.onUsage,
    onChunk(event) {
      const cid = getChatId();
      switch (event.type) {
        case "turn_start":
          completeRunningTools(cid);
          break;
        case "text":
          completeRunningTools(cid);
          appendToLastAssistant(cid, (event.content as string) || "");
          break;
        case "thinking":
          appendToLastAssistant(
            cid,
            "",
            (event.content as string) || ""
          );
          break;
        case "tool_use": {
          completeRunningTools(cid);
          const toolName = (event.name as string) || "Unknown";
          const toolInput = (event.input as Record<string, unknown>) || {};
          addToolCall(cid, {
            id: (event.id as string) || `tool_${Date.now()}`,
            name: toolName,
            input: toolInput,
            status: "running",
            startTime: Date.now(),
          });
          // Track artifact files from Write/Edit/Bash tool calls
          const categorized = categorizeToolCall(toolName, toolInput);
          if (categorized?.category === "artifact" && isValidSidebarEntry(categorized.path)) {
            addArtifactFile(categorized.path);
            if (currentProjectId) {
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
            }
          }
          break;
        }
        case "tool_result":
          updateToolResult(
            cid,
            (event.tool_use_id as string) || (event.id as string) || "",
            typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result),
            event.is_error as boolean | undefined
          );
          break;
        case "input_request":
          addMessage(cid, {
            id: (event.toolUseId as string) || `q_${Date.now()}`,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            questionData: event.questions,
            questionToolUseId: event.toolUseId as string,
          });
          if (!document.hasFocus()) {
            showNotification("Claude needs your input", "A question or permission prompt is waiting for you.");
          }
          break;
        case "system_init":
          // Record how many tools actually got mounted so the Connectors screen can
          // warn when connecting more has started to hurt tool selection (P3.5).
          if (event.toolBudget) {
            useToolBudgetStore.getState().setReport(event.toolBudget as ToolBudgetReport);
          }
          break;
        case "document_print":
          // Relay to Electron main, which owns Chromium (P4.2b).
          void printDocument({
            toolUseId: event.toolUseId as string,
            html: event.html as string,
            outputPath: event.outputPath as string,
            printOptions: event.printOptions as Record<string, unknown> | undefined,
          });
          break;
        case "connector_request":
          addMessage(cid, {
            id: (event.toolUseId as string) || `conn_${Date.now()}`,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            connectorRequest: {
              connectorId: event.connectorId as string,
              reason: event.reason as string | undefined,
              toolUseId: event.toolUseId as string,
            },
          });
          if (!document.hasFocus()) {
            showNotification("A connection is needed", "AIME is waiting to connect a service.");
          }
          break;
        case "canvas":
          onCanvasEvent(event as { doc?: unknown });
          break;
        case "cron_create": {
          try {
            const input = event.input as Record<string, unknown>;
            const expression = (input.cron || input.expression) as string;
            const prompt = (input.prompt || input.message || input.task) as string;
            if (expression && prompt) {
              useAssistantStore.getState().addOrder({
                instruction: prompt,
                trigger: { type: 'cron', expression },
                notifyVia: 'toast',
              });
            }
          } catch (e) {
            console.error('[Chat] CronCreate parse error:', e);
          }
          break;
        }
        case "widget_create": {
          // The chat → Cockpit pin loop (P6/K5): the model called WidgetCreate.
          try {
            handleWidgetCreateEvent(event as Record<string, unknown>);
          } catch (e) {
            console.error('[Chat] WidgetCreate parse error:', e);
          }
          break;
        }
        case "prompt_suggestion": {
          const suggestion = event.suggestion as string;
          if (suggestion) {
            addSuggestion(getChatId(), suggestion);
          }
          break;
        }
        case "document_extracted": {
          const extractedText = event.extractedText as string | undefined;
          const docName = event.name as string;
          const did = getChatId();
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
        case "memory_extract":
          handleMemoryExtractEvent(
            event.memories as Array<{ content: string; category: string; tags: string[]; confidence: number }>,
            getChatId(),
          );
          break;
        case "error":
          appendToLastAssistant(
            cid,
            `\n\n**Error:** ${(event.message as string) || "An error occurred"}`
          );
          break;
      }
    },
    onDone() {
      runRecorder.succeed();
      const doneId = getChatId();
      completeRunningTools(doneId);
      stopStreaming(doneId);
      // Detect binary artifacts from Bash tool calls (e.g. ppt plugin .pptx output)
      if (doneId) {
        const msgs = useChatStore.getState().messages[doneId] ?? [];
        for (const msg of msgs) {
          for (const tc of msg.toolCalls ?? []) {
            if (tc.name === "Bash" && tc.input?.command) {
              const cmd = String(tc.input.command);
              BASH_ARTIFACT_EXT.lastIndex = 0;
              let match;
              while ((match = BASH_ARTIFACT_EXT.exec(cmd)) !== null) {
                const filePath = match[1];
                if (filePath.length < 3 || filePath.startsWith(".") || filePath === "/dev/null") continue;
                if (!isValidSidebarEntry(filePath)) continue;
                addArtifactFile(filePath);
              }
            }
          }
        }
      }
      if (!document.hasFocus()) {
        showNotification("Task complete", "Claude has finished working on your request.");
      }
    },
    onError(error) {
      runRecorder.fail(error.message);
      stopStreaming(getChatId());
      appendToLastAssistant(getChatId(), `\n\n**Error:** ${error.message}`);
    },
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const trimmed = text.trim();

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
          addMessage(id, { id: crypto.randomUUID(), role: "user", content: trimmed, timestamp: Date.now() });
          addMessage(id, { id: crypto.randomUUID(), role: "assistant", content: result.message, timestamp: Date.now() });
          setInputValue("");
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

      addMessage(id, {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
        attachments: attachments.length > 0 ? attachments.map(a => ({ name: a.name, content: '', type: a.type, category: a.category as 'image' | 'document' | 'text' })) : undefined,
      });

      updateConversation(id, {
        title: trimmed.substring(0, 50),
        lastMessage: trimmed,
        updatedAt: Date.now(),
      });

      addMessage(id, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isLoading: true,
        isStreaming: true,
      });

      startStreaming(id);
      setInputValue("");

      const currentAttachments = [...attachments];
      const currentWebSearch = webSearchEnabled;
      setAttachments([]);
      setWebSearchEnabled(false);

      if (currentWebSearch) sendFeatureAdoptionEvent({ feature: 'web_search', surface: 'chat' });
      if (currentAttachments.length > 0) sendFeatureAdoptionEvent({ feature: 'file_attachment', surface: 'chat' });
      if (sessionControls.thinkLevel && sessionControls.thinkLevel !== 'off') sendFeatureAdoptionEvent({ feature: 'extended_thinking', surface: 'chat' });

      // Grab prior messages for history fallback (exclude just-added user + assistant placeholder)
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

      // Clear prompt suggestions when user sends a new message
      if (chatId) clearSuggestions(chatId);

      // A tier route resolves here (it can land on a user provider's model); a
      // pinned model passes through. Null ⇒ nothing resolved, so fall back to
      // the surface's built-in model rather than send an empty one.
      const route = resolveSendRoute(modelRoute, providers, {
        capability: CAPABILITY,
        tierModels,
        hasAnthropicKey: !!anthropicApiKey,
      });

      // Open the run record before the turn starts so an immediate failure is
      // still attributed rather than lost.
      runRecorder.begin({ trigger: "chat", model: route?.model ?? model });
      await sendMessage(trimmed, id, "chat", route?.model ?? model, {
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
      });
    },
    [
      chatId,
      model,
      runRecorder,
      modelRoute,
      providers,
      tierModels,
      anthropicApiKey,
      addMessage,
      startStreaming,
      sendMessage,
      updateConversation,
      addConversation,
      setActiveConversation,
      setCurrentChat,
      personalPreferences,
      displayName,
      attachments,
      webSearchEnabled,
      projectInstructions,
      projectKnowledge,
      // Read inside the callback and previously missing, so a slash command or a
      // project change did not take effect until some other dep changed. All
      // six are primitives or stable store references, so adding them only
      // affects this callback's identity — it is never used in an effect.
      sessionControls,
      setSessionControlsInStore,
      clearSuggestions,
      currentProjectId,
      crossSurfaceContext,
      toolProfile,
    ]
  );

  const handleQuestionAnswered = useCallback(
    (toolUseId: string) => {
      if (chatId) updateMessage(chatId, toolUseId, { questionAnswered: true });
    },
    [chatId, updateMessage]
  );

  const handleRetry = useCallback(() => {
    if (!chatId || isStreaming) return;
    const msgs = useChatStore.getState().messages[chatId];
    if (!msgs || msgs.length < 2) return;
    // Find last user message
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;
    handleSubmit(lastUserMsg.content);
  }, [chatId, isStreaming, handleSubmit]);

  const handleVoiceTranscript = useCallback(
    (text: string) => setInputValue((prev) => (prev ? `${prev} ${text}` : text)),
    []
  );


  // Push-to-talk: the global hotkey routes to the same handler as the mic

  // button, so dictation works without focusing the window (P4.1).

  usePushToTalk({

    onTranscript: handleVoiceTranscript,

    enabled: pushToTalkEnabled,

  });

  // Merged suggestions: slash takes priority
  const activeSuggestions: CommandSuggestion[] = cmdSuggestions.length > 0
    ? cmdSuggestions
    : fileSuggestions.map((f) => ({
        type: 'at' as const,
        value: f.path,
        label: '@' + f.name,
        description: undefined,
        meta: f.relative,
      }));

  function handleSelectSuggestion(s: CommandSuggestion) {
    if (s.type === 'slash') {
      setInputValue(s.value + ' ');
      setCmdSuggestions([]);
    } else {
      const newVal = removeAtQuery(inputValue);
      setInputValue(newVal);
      clearAtSuggestions();
      resolveFileAsAttachment(s.value).then((att) => {
        if (att) setAttachments((prev) => [...prev, att]);
      });
    }
    setSelectedSuggestionIdx(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (activeSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIdx((i) => Math.min(i + 1, activeSuggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && activeSuggestions.length > 0)) {
        e.preventDefault();
        handleSelectSuggestion(activeSuggestions[selectedSuggestionIdx]);
        return;
      }
      if (e.key === 'Escape') {
        setCmdSuggestions([]);
        clearAtSuggestions();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        abort();
      } else {
        handleSubmit(inputValue);
      }
    }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInputValue(val);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    // Slash suggestions
    setCmdSuggestions(
      getSlashSuggestions(val).map((cmd) => ({
        type: 'slash' as const,
        value: cmd.name,
        label: cmd.name,
        description: cmd.args,
        meta: cmd.description,
      }))
    );
    // @ file suggestions: chat has no CWD so just clear them
    clearAtSuggestions();
    setSelectedSuggestionIdx(0);
  }

  function handleButtonClick() {
    if (isStreaming) {
      abort();
    } else {
      handleSubmit(inputValue);
    }
  }

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
            <CommandPicker
              suggestions={activeSuggestions}
              selectedIndex={selectedSuggestionIdx}
              onSelect={handleSelectSuggestion}
              onSelectedIndexChange={setSelectedSuggestionIdx}
            />
            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <Textarea
                value={inputValue}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder="How can I help you today?"
                rows={3}
                className="min-h-[120px] max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pb-0"
              />
              {/* Attachment chips */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-4 pt-2">
                  {attachments.map((att, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      <AttachmentIcon category={att.category} />
                      {att.name}
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-1">
                  <AttachmentMenu
                    onFileSelect={(file) => setAttachments((prev) => [...prev, file])}
                    onWebSearchToggle={() => setWebSearchEnabled((prev) => !prev)}
                    webSearchEnabled={webSearchEnabled}
                    currentProjectId={currentProjectId}
                    onAddToProject={(pid) => assignToProject(chatId, pid)}
                    onNewProject={() => setSidebarMode("projects")}
                    projects={allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
                  />
                  <VoiceButton onTranscript={handleVoiceTranscript} />
                </div>
                <div className="flex items-center gap-2">
                  <ModelSelector
                    value={modelRoute ? modelRoute.id : model}
                    onChange={setModel}
                    onSelectModel={(opt) => setModelRoute(opt.kind === 'tier' || opt.providerConfig ? opt : null)}
                    className="border-0 bg-transparent shadow-none h-6 w-auto text-muted-foreground"
                  />
                  <Button
                    size="icon"
                    className="h-8 w-8 rounded-lg bg-primary hover:bg-primary/80"
                    onClick={handleButtonClick}
                    disabled={!inputValue.trim()}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Quick-start suggestion pills */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              {[
                { label: "Write", icon: "✏️", prompt: "Help me write " },
                { label: "Learn", icon: "✨", prompt: "Explain to me " },
                { label: "Code", icon: "</>", prompt: "Write code that " },
                { label: "Brainstorm", icon: "💡", prompt: "Brainstorm ideas for " },
              ].map((pill) => (
                <button
                  key={pill.label}
                  onClick={() => { setInputValue(pill.prompt); setTimeout(() => document.querySelector<HTMLTextAreaElement>('[placeholder="How can I help you today?"]')?.focus(), 50); }}
                  className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-card hover:border-border transition-colors"
                >
                  <span>{pill.icon}</span>
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
              <MessageList messages={messages} conversationId={chatId} surfaceId="chat" onArtifactClick={handleArtifactClick} onQuestionAnswered={handleQuestionAnswered} onRetry={handleRetry} onCancel={chatId ? () => streamRegistry.abort(chatId) : undefined} />

              {/* Prompt suggestions */}
              {suggestions.length > 0 && !isStreaming && (
                <div className="px-6 pb-1">
                  <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => setInputValue(s)}
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
                  <CommandPicker
                    suggestions={activeSuggestions}
                    selectedIndex={selectedSuggestionIdx}
                    onSelect={handleSelectSuggestion}
                    onSelectedIndexChange={setSelectedSuggestionIdx}
                  />
                  <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                    <Textarea
                      value={inputValue}
                      onChange={handleTextareaChange}
                      onKeyDown={handleKeyDown}
                      placeholder="Reply..."
                      rows={2}
                      className="min-h-[56px] max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pb-0"
                      style={{ opacity: isStreaming ? 0.6 : 1 }}
                    />
                    {/* Attachment chips */}
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 px-4 pt-2">
                        {attachments.map((att, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                          >
                            {att.name}
                            <button
                              type="button"
                              onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                              className="hover:text-foreground"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <AttachmentMenu
                          onFileSelect={(file) => setAttachments((prev) => [...prev, file])}
                          onWebSearchToggle={() => setWebSearchEnabled((prev) => !prev)}
                          webSearchEnabled={webSearchEnabled}
                          currentProjectId={currentProjectId}
                          onAddToProject={(pid) => assignToProject(chatId, pid)}
                          onNewProject={() => setSidebarMode("projects")}
                          projects={allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
                        />
                        <VoiceButton onTranscript={handleVoiceTranscript} />
                      </div>
                      <div className="flex items-center gap-2">
                        <ModelSelector
                          value={modelRoute ? modelRoute.id : model}
                          onChange={setModel}
                          onSelectModel={(opt) => setModelRoute(opt.kind === 'tier' || opt.providerConfig ? opt : null)}
                          className="border-0 bg-transparent shadow-none h-6 w-auto text-muted-foreground"
                        />
                        <Button
                          size="icon"
                          className={`h-8 w-8 rounded-lg ${
                            isStreaming
                              ? "bg-destructive hover:bg-destructive/80"
                              : "bg-primary hover:bg-primary/80"
                          }`}
                          onClick={handleButtonClick}
                          disabled={!isStreaming && !inputValue.trim()}
                        >
                          {isStreaming ? (
                            <Square className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUp className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Artifacts sidebar — collapsible. When collapsed, a 40px-wide
                strip with just an expand button so canvases stay findable. */}
            <div className={`shrink-0 border-l border-border bg-card/50 flex flex-col transition-all duration-200 ${artifactsSidebarOpen ? 'w-64' : 'w-10'}`}>
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
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50">
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
              )}
              {artifactsSidebarOpen && (
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
                {artifactFiles.map((filePath) => {
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
