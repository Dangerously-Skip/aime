"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageList } from "@/components/shared/message-list";
import { ModelSelector } from "@/components/shared/model-selector";
import { FolderPicker } from "@/components/shared/folder-picker";
import { AttachmentMenu } from "@/components/shared/attachment-menu";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { useCoworkStore } from "@/stores/cowork-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream } from "@/hooks/use-sse-stream";
import { useProjectContext } from "@/hooks/use-project-context";
import { useFileDrop } from "@/hooks/use-file-drop";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { Message } from "@/stores/chat-store";
import {
  Briefcase,
  ChevronDown,
  FileText,
  FilePen,
  ArrowUp,
  Square,
  X,
  PanelRightClose,
  PanelRight,
  FolderOpen,
} from "lucide-react";

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_FILES: string[] = [];

const CONTEXT_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Bash"]);
const ARTIFACT_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

function extractFilePath(input: Record<string, unknown>): string | null {
  const raw = input.file_path || input.path || input.pattern || input.url || input.query;
  return typeof raw === "string" ? raw : null;
}

function fileDisplayName(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function openFile(path: string) {
  // Use Electron shell to open files, or fallback to window.open for URLs
  if (path.startsWith("http")) {
    window.open(path, "_blank");
  } else if (window.electronAPI?.openPath) {
    window.electronAPI.openPath(path);
  }
}

function SidebarCard({
  label,
  icon: Icon,
  items,
  emptyText,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
  emptyText: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-border/50 bg-card/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold hover:bg-muted/30 transition-colors rounded-t-xl"
      >
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-3">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">{emptyText}</p>
          ) : (
            <div className="space-y-1.5">
              {items.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => openFile(path)}
                  className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs hover:bg-muted/70 transition-colors text-left group"
                  title={path}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate group-hover:text-foreground">{fileDisplayName(path)}</span>
                  <ChevronDown className="h-3 w-3 -rotate-90 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 ml-auto" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SidebarPanel({
  contextFiles,
  artifactFiles,
  folder,
  open,
  onToggle,
}: {
  contextFiles: string[];
  artifactFiles: string[];
  folder: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`flex flex-col shrink-0 transition-all duration-200 ${open ? "w-[300px]" : "w-10"}`}>
      {/* Toggle button */}
      <div className={`flex items-center ${open ? "justify-end px-3" : "justify-center"} py-2`}>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onToggle}
        >
          {open ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
        </Button>
      </div>

      {open && (
        <ScrollArea className="flex-1 px-3 pb-3">
          <div className="space-y-3">
            {/* Working folder */}
            {folder && (
              <div className="rounded-xl border border-border/50 bg-card/50">
                <div className="px-4 py-3 text-sm font-semibold">Working folder</div>
                <div className="px-4 pb-3">
                  <button
                    type="button"
                    onClick={() => openFile(folder)}
                    className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs hover:bg-muted/70 transition-colors text-left group"
                    title={folder}
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate group-hover:text-foreground">{folder.split("/").slice(-2).join("/")}</span>
                    <ChevronDown className="h-3 w-3 -rotate-90 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 ml-auto" />
                  </button>
                </div>
              </div>
            )}

            <SidebarCard
              label="Context"
              icon={FileText}
              items={contextFiles}
              emptyText="Files read during this session will appear here."
            />

            <SidebarCard
              label="Artifacts"
              icon={FilePen}
              items={artifactFiles}
              emptyText="Files created or edited will appear here."
            />
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export function CoworkSurface() {
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const handleFileAttach = useCallback(
    (file: AttachmentFile) => {
      setAttachments((prev) => [...prev, file]);
      const cid = useCoworkStore.getState().currentChatId;
      if (cid) useCoworkStore.getState().addContextFile(cid, file.name);
    },
    []
  );
  const { isDragging, dropZoneProps } = useFileDrop(handleFileAttach);
  const currentChatId = useCoworkStore((s) => s.currentChatId);
  const chatId = currentChatId ?? "";
  const messages = useCoworkStore(
    (s) => (s.currentChatId ? s.messages[s.currentChatId] : undefined) ?? EMPTY_MESSAGES
  );
  const model = useCoworkStore((s) => s.model);
  const isStreaming = useCoworkStore((s) => s.isStreaming);
  const folder = useCoworkStore((s) => s.folder);
  const contextFiles = useCoworkStore((s) => (chatId ? s.contextFiles[chatId] : undefined) ?? EMPTY_FILES);
  const artifactFiles = useCoworkStore((s) => (chatId ? s.artifactFiles[chatId] : undefined) ?? EMPTY_FILES);
  const setModel = useCoworkStore((s) => s.setModel);
  const setFolder = useCoworkStore((s) => s.setFolder);
  const addMessage = useCoworkStore((s) => s.addMessage);
  const appendToLastAssistant = useCoworkStore((s) => s.appendToLastAssistant);
  const addToolCall = useCoworkStore((s) => s.addToolCall);
  const updateToolResult = useCoworkStore((s) => s.updateToolResult);
  const addContextFile = useCoworkStore((s) => s.addContextFile);
  const addArtifactFile = useCoworkStore((s) => s.addArtifactFile);
  const startStreaming = useCoworkStore((s) => s.startStreaming);
  const stopStreaming = useCoworkStore((s) => s.stopStreaming);
  const setCurrentChat = useCoworkStore((s) => s.setCurrentChat);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const activeConvId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const personalPreferences = useSettingsStore((s) => s.personalPreferences);
  const displayName = useSettingsStore((s) => s.displayName);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);
  const { projectInstructions, projectKnowledge } = useProjectContext(chatId);

  useEffect(() => {
    if (!activeConvId) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    if (conv?.surface === "cowork") setCurrentChat(activeConvId);
  }, [activeConvId, conversations, setCurrentChat]);

  const { sendMessage, abort } = useSSEStream({
    onChunk(event) {
      switch (event.type) {
        case "text":
          appendToLastAssistant(chatId, (event.content as string) || "");
          break;
        case "thinking":
          appendToLastAssistant(chatId, "", (event.content as string) || "");
          break;
        case "tool_use": {
          const toolId = (event.id as string) || `tool_${Date.now()}`;
          const toolName = (event.name as string) || "Unknown";
          const toolInput = (event.input as Record<string, unknown>) || {};
          addToolCall(chatId, {
            id: toolId,
            name: toolName,
            input: toolInput,
            status: "running",
            startTime: Date.now(),
          });
          // Categorize into sidebar panels
          const filePath = extractFilePath(toolInput);
          if (filePath && chatId) {
            if (CONTEXT_TOOLS.has(toolName)) {
              addContextFile(chatId, filePath);
            } else if (ARTIFACT_TOOLS.has(toolName)) {
              addArtifactFile(chatId, filePath);
            }
          }
          break;
        }
        case "tool_result": {
          const id = (event.tool_use_id as string) || (event.id as string) || "";
          const result =
            typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
          updateToolResult(chatId, id, result, event.is_error as boolean | undefined);
          break;
        }
        case "error":
          appendToLastAssistant(
            chatId,
            `\n\n**Error:** ${(event.message as string) || "An error occurred"}`
          );
          break;
      }
    },
    onDone: () => stopStreaming(chatId),
    onError: (error) => {
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
          title: trimmed.substring(0, 50),
          surface: "cowork",
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
      setAttachments([]);
      await sendMessage(trimmed, id, "cowork", model, {
        personalPreferences: personalPreferences || undefined,
        displayName: displayName || undefined,
        projectInstructions: projectInstructions || undefined,
        projectKnowledge: projectKnowledge || undefined,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        apiKey: nibGatewayApiKey || undefined,
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
      projectInstructions,
      projectKnowledge,
      attachments,
    ]
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

  const hasMessages = messages.length > 0;

  const attachmentChips = attachments.length > 0 && (
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
  );

  return (
    <div className="relative flex h-full flex-col bg-background" {...dropZoneProps}>
      <DropOverlay visible={isDragging} />
      {/* ── Empty state: centered greeting + input ── */}
      {!hasMessages ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 animate-in fade-in duration-300">
          {/* Greeting */}
          <div className="flex items-center gap-3 mb-3">
            <Briefcase className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-light text-foreground tracking-tight">
              Let&apos;s knock something off your list
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mb-8">
            Select a folder and describe your task — Claude will read, write, and edit files alongside you.
          </p>

          {/* Centered input card */}
          <div className="w-full max-w-2xl">
            <div
              className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
            >
              <Textarea
                value={inputValue}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder="What would you like to work on?"
                rows={3}
                className="min-h-[120px] max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pb-0"
              />
              {attachmentChips}
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-1">
                  <AttachmentMenu
                    onFileSelect={handleFileAttach}
                    onWebSearchToggle={() => {}}
                    webSearchEnabled={false}
                  />
                  <FolderPicker folder={folder} onFolderChange={setFolder} />
                </div>
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
        /* ── Active state: messages + sidebar (no header bar) ── */
        <div className="flex flex-1 min-h-0">
          {/* Messages column */}
          <div className="flex flex-1 flex-col min-w-0">
            <MessageList messages={messages} />

            {/* Bottom input card */}
            <div className="px-6 pb-4 pt-2">
              <div className="max-w-3xl mx-auto">
                <div
                  className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
                >
                  <Textarea
                    value={inputValue}
                    onChange={handleTextareaChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe your task..."
                    rows={2}
                    className="min-h-[56px] max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pb-0"
                    style={{ opacity: isStreaming ? 0.6 : 1 }}
                  />
                  {attachmentChips}
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <AttachmentMenu
                        onFileSelect={handleFileAttach}
                        onWebSearchToggle={() => {}}
                        webSearchEnabled={false}
                      />
                      <FolderPicker folder={folder} onFolderChange={setFolder} />
                    </div>
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
          </div>

          {/* Sidebar: Context + Artifacts */}
          <SidebarPanel
            contextFiles={contextFiles}
            artifactFiles={artifactFiles}
            folder={folder}
            open={sidebarOpen}
            onToggle={() => setSidebarOpen((prev) => !prev)}
          />
        </div>
      )}
    </div>
  );
}
