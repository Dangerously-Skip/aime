"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MessageList } from "@/components/shared/message-list";
import { ModelSelector } from "@/components/shared/model-selector";
import { ChatTitleBar } from "@/components/shared/chat-title-bar";
import { useChatStore } from "@/stores/chat-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream, stripMessagesForHistory } from "@/hooks/use-sse-stream";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowUp, Square, Sparkles, X, ImageIcon, FileText, File } from "lucide-react";
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

function AttachmentIcon({ category }: { category: AttachmentFile['category'] }) {
  switch (category) {
    case 'image': return <ImageIcon className="h-3 w-3" />
    case 'document': return <File className="h-3 w-3" />
    default: return <FileText className="h-3 w-3" />
  }
}

const EMPTY_MESSAGES: Message[] = [];

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
  const { isDragging, dropZoneProps } = useFileDrop(
    useCallback((file: AttachmentFile) => setAttachments((prev) => [...prev, file]), [])
  );
  const currentChatId = useChatStore((s) => s.currentChatId);
  const chatId = currentChatId ?? "";
  const messages = useChatStore(
    (s) =>
      (s.currentChatId ? s.messages[s.currentChatId] : undefined) ??
      EMPTY_MESSAGES
  );
  const model = useChatStore((s) => s.model);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setModel = useChatStore((s) => s.setModel);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendToLastAssistant = useChatStore(
    (s) => s.appendToLastAssistant
  );
  const addToolCall = useChatStore((s) => s.addToolCall);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const updateToolResult = useChatStore((s) => s.updateToolResult);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const setCurrentChat = useChatStore((s) => s.setCurrentChat);
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
  const personalPreferences = useSettingsStore((s) => s.personalPreferences);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);
  const { projectInstructions, projectKnowledge, projectName, projectIcon, projectId: currentProjectId, crossSurfaceContext, projectFolder } = useProjectContext(chatId, "chat");
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const navigateToProject = useAppStore((s) => s.navigateToProject);

  const { showNotification } = useElectron();
  const isEmpty = messages.length === 0;
  const currentConversation = conversations.find((c) => c.id === chatId);
  const chatTitle = currentConversation?.title || "New conversation";

  useEffect(() => {
    if (!activeConvId) return;
    const conv = allConversations.find((c) => c.id === activeConvId);
    if (conv?.surface === "chat") setCurrentChat(activeConvId);
  }, [activeConvId, allConversations, setCurrentChat]);

  // Episodic memory: summarize previous conversation when switching
  const prevChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevChatIdRef.current;
    prevChatIdRef.current = chatId || null;
    if (prevId && prevId !== chatId) {
      const prevMessages = useChatStore.getState().messages[prevId];
      if (prevMessages && prevMessages.length > 0) {
        summarizeConversation(prevId, prevMessages);
      }
    }
  }, [chatId]);

  const { sendMessage, abort } = useSSEStream({
    onChunk(event) {
      switch (event.type) {
        case "text":
          appendToLastAssistant(chatId, (event.content as string) || "");
          break;
        case "thinking":
          appendToLastAssistant(
            chatId,
            "",
            (event.content as string) || ""
          );
          break;
        case "tool_use":
          addToolCall(chatId, {
            id: (event.id as string) || `tool_${Date.now()}`,
            name: (event.name as string) || "Unknown",
            input: (event.input as Record<string, unknown>) || {},
            status: "running",
            startTime: Date.now(),
          });
          break;
        case "tool_result":
          updateToolResult(
            chatId,
            (event.tool_use_id as string) || (event.id as string) || "",
            typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result),
            event.is_error as boolean | undefined
          );
          break;
        case "input_request":
          addMessage(chatId, {
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
        case "memory_extract":
          handleMemoryExtractEvent(
            event.memories as Array<{ content: string; category: string; tags: string[]; confidence: number }>,
            chatId,
          );
          break;
        case "error":
          appendToLastAssistant(
            chatId,
            `\n\n**Error:** ${(event.message as string) || "An error occurred"}`
          );
          break;
      }
    },
    onDone() {
      stopStreaming(chatId);
      if (!document.hasFocus()) {
        showNotification("Task complete", "Claude has finished working on your request.");
      }
    },
    onError(error) {
      stopStreaming(chatId);
      appendToLastAssistant(chatId, `\n\n**Error:** ${error.message}`);
    },
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const trimmed = text.trim();

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

      await sendMessage(trimmed, id, "chat", model, {
        personalPreferences: personalPreferences || undefined,
        displayName: displayName || undefined,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        webSearch: currentWebSearch || undefined,
        projectInstructions: projectInstructions || undefined,
        projectKnowledge: projectKnowledge || undefined,
        apiKey: nibGatewayApiKey || undefined,
        history: history.length > 0 ? history : undefined,
        memories: memoriesStr || undefined,
        crossSurfaceContext: crossSurfaceContext || undefined,
      });
    },
    [
      chatId,
      model,
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
    ]
  );

  const handleQuestionAnswered = useCallback(
    (toolUseId: string) => {
      if (chatId) updateMessage(chatId, toolUseId, { questionAnswered: true });
    },
    [chatId, updateMessage]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
    setInputValue(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
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
                <AttachmentMenu
                  onFileSelect={(file) => setAttachments((prev) => [...prev, file])}
                  onWebSearchToggle={() => setWebSearchEnabled((prev) => !prev)}
                  webSearchEnabled={webSearchEnabled}
                  currentProjectId={currentProjectId}
                  onAddToProject={(pid) => assignToProject(chatId, pid)}
                  projects={allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
                />
                <div className="flex items-center gap-2">
                  <ModelSelector
                    value={model}
                    onChange={setModel}
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
          </div>
        </div>
      ) : (
        /* ── Active conversation: title + messages + bottom input ── */
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

          {/* Messages */}
          <MessageList messages={messages} conversationId={chatId} onArtifactClick={handleArtifactClick} onQuestionAnswered={handleQuestionAnswered} />

          {/* Bottom input card */}
          <div className="px-6 pb-4 pt-2">
            <div className="max-w-3xl mx-auto">
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
                  <AttachmentMenu
                    onFileSelect={(file) => setAttachments((prev) => [...prev, file])}
                    onWebSearchToggle={() => setWebSearchEnabled((prev) => !prev)}
                    webSearchEnabled={webSearchEnabled}
                    currentProjectId={currentProjectId}
                    onAddToProject={(pid) => assignToProject(chatId, pid)}
                    projects={allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
                  />
                  <div className="flex items-center gap-2">
                    <ModelSelector
                      value={model}
                      onChange={setModel}
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
        </>
      )}

      {/* Artifact preview panel */}
      <ArtifactPanel
        artifact={activeArtifact}
        open={activeArtifact !== null}
        onClose={() => setActiveArtifact(null)}
        projectFolder={projectFolder}
        conversationId={chatId}
        projectId={currentProjectId}
        onArtifactSaved={handleArtifactSaved}
      />
    </div>
  );
}
