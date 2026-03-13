"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ModelSelector } from "@/components/shared/model-selector";
import { FolderPicker } from "@/components/shared/folder-picker";
import { ToolCallCard } from "@/components/shared/tool-call-card";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import { StreamingCursor } from "@/components/shared/streaming-cursor";
import { AttachmentMenu } from "@/components/shared/attachment-menu";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { useFileDrop } from "@/hooks/use-file-drop";
import { useCodeStore, type PermissionMode } from "@/stores/code-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream } from "@/hooks/use-sse-stream";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ConnectionSelector } from "@/components/shared/connection-selector";
import {
  ArrowUp,
  Square,
  Shield,
  Code2,
  FileText,
  AlertTriangle,
  X,
  ImageIcon,
  File,
} from "lucide-react";
import type { Message } from "@/stores/chat-store";

const EMPTY_MESSAGES: Message[] = [];

/* ── Pixel mascot (jiggling character) ── */
function Mascot() {
  return (
    <img
      src="/mascot.png"
      alt="Mascot"
      width={80}
      height={80}
      className="mb-4 mascot-jiggle"
    />
  );
}

/* ── Permission mode config ── */
const PERMISSION_MODES: {
  value: PermissionMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: "default",
    icon: Shield,
    label: "Ask permissions",
    description: "Always ask before making changes",
  },
  {
    value: "acceptEdits",
    icon: Code2,
    label: "Auto accept edits",
    description: "Automatically accept all file edits",
  },
  {
    value: "plan",
    icon: FileText,
    label: "Plan mode",
    description: "Create a plan before making changes",
  },
  {
    value: "bypass",
    icon: AlertTriangle,
    label: "Bypass permissions",
    description: "Accepts all permissions",
  },
];

function getPermissionIcon(mode: PermissionMode) {
  const config = PERMISSION_MODES.find((m) => m.value === mode);
  if (!config) return Shield;
  return config.icon;
}

function getPermissionLabel(mode: PermissionMode) {
  const config = PERMISSION_MODES.find((m) => m.value === mode);
  return config?.label ?? "Ask permissions";
}

/* ── Attachment chip icon ── */
function AttachmentIcon({ category }: { category: AttachmentFile["category"] }) {
  switch (category) {
    case "image":
      return <ImageIcon className="h-3 w-3" />;
    case "document":
      return <File className="h-3 w-3" />;
    default:
      return <FileText className="h-3 w-3" />;
  }
}

/* ── Terminal message output ── */
interface TerminalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    output?: string;
    status: "running" | "complete" | "error";
    startTime: number;
    endTime?: number;
  }>;
  thinking?: string;
  isStreaming?: boolean;
  isLoading?: boolean;
}

function TerminalOutput({ messages }: { messages: TerminalMessage[] }) {
  return (
    <div className="space-y-3 text-sm">
      {messages.map((msg) => {
        if (msg.role === "user") {
          return (
            <div key={msg.id} className="font-mono text-foreground">
              <span className="text-muted-foreground select-none">&gt; </span>
              <span>{msg.content}</span>
            </div>
          );
        }
        return (
          <div key={msg.id} className="space-y-2">
            {msg.thinking && (
              <div className="text-xs text-muted-foreground italic pl-3 border-l-2 border-muted">
                {msg.thinking}
              </div>
            )}
            {msg.toolCalls?.map((tool) => (
              <ToolCallCard
                key={tool.id}
                name={tool.name}
                input={tool.input}
                output={tool.output}
                status={tool.status}
                startTime={tool.startTime}
                endTime={tool.endTime}
              />
            ))}
            {msg.content && (
              <div className="pl-1">
                <MarkdownRenderer content={msg.content} />
                {msg.isStreaming && <StreamingCursor />}
              </div>
            )}
            {msg.isLoading && !msg.content && (
              <div className="pl-1 text-muted-foreground">
                <span className="loading-asterisk inline-block">*</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Input card (shared between empty & active states) ── */
function CodeInput({
  value,
  onChange,
  onSubmit,
  onAbort,
  isStreaming,
  permissionMode,
  onPermissionModeChange,
  model,
  onModelChange,
  placeholder,
  rows,
  minHeight,
  attachments,
  onAttachmentAdd,
  onAttachmentRemove,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onAbort?: () => void;
  isStreaming: boolean;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  model: string;
  onModelChange: (model: string) => void;
  placeholder: string;
  rows: number;
  minHeight: string;
  attachments: AttachmentFile[];
  onAttachmentAdd: (file: AttachmentFile) => void;
  onAttachmentRemove: (index: number) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const PermIcon = getPermissionIcon(permissionMode);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        onAbort?.();
      } else if (value.trim()) {
        onSubmit(value.trim());
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }

  function handleButtonClick() {
    if (isStreaming) {
      onAbort?.();
    } else if (value.trim()) {
      onSubmit(value.trim());
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        className={`${minHeight} max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pb-0`}
        style={{ opacity: isStreaming ? 0.6 : 1 }}
      />

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-2">
          {attachments.map((att, i) => (
            <span
              key={`${att.name}-${i}`}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              <AttachmentIcon category={att.category} />
              <span className="max-w-[120px] truncate">{att.name}</span>
              <button
                onClick={() => onAttachmentRemove(i)}
                className="ml-0.5 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2.5">
        {/* Left: attachment menu and permission mode */}
        <div className="flex items-center gap-1">
          <AttachmentMenu
            onFileSelect={onAttachmentAdd}
            onWebSearchToggle={() => {}}
            webSearchEnabled={false}
          />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <PermIcon className="h-3.5 w-3.5" />
                  <span>{getPermissionLabel(permissionMode)}</span>
                </button>
              }
            />
            <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64">
              <DropdownMenuRadioGroup
                value={permissionMode}
                onValueChange={(v) => onPermissionModeChange(v as PermissionMode)}
              >
                {PERMISSION_MODES.map((mode) => (
                  <DropdownMenuRadioItem
                    key={mode.value}
                    value={mode.value}
                    className="flex items-start gap-2 py-2"
                  >
                    <mode.icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{mode.label}</span>
                      <span className="text-xs text-muted-foreground">{mode.description}</span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Right: model selector and send */}
        <div className="flex items-center gap-2">
          <ModelSelector
            value={model}
            onChange={onModelChange}
            className="border-0 bg-transparent shadow-none h-6 w-auto text-muted-foreground"
          />
          <Button
            size="icon"
            className={`h-8 w-8 shrink-0 rounded-full ${
              isStreaming
                ? "bg-destructive hover:bg-destructive/80"
                : "bg-primary hover:bg-primary/80"
            }`}
            onClick={handleButtonClick}
            disabled={!isStreaming && !value.trim()}
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
  );
}

/* ── Bottom bar: folder + connection ── */
function BottomBar({
  folder,
  onFolderChange,
}: {
  folder: string | null;
  onFolderChange: (f: string | null) => void;
}) {
  return (
    <div className="flex items-center justify-between px-1 pt-2">
      <FolderPicker
        folder={folder}
        onFolderChange={onFolderChange}
        className="border-0 bg-transparent shadow-none text-muted-foreground hover:text-foreground h-6 px-1"
      />
      <ConnectionSelector />
    </div>
  );
}

/* ── Main surface ── */
export function CodeSurface() {
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentChatId = useCodeStore((s) => s.currentChatId);
  const chatId = currentChatId ?? "";
  const messages = useCodeStore(
    (s) =>
      (s.currentChatId ? s.messages[s.currentChatId] : undefined) ??
      EMPTY_MESSAGES
  );
  const model = useCodeStore((s) => s.model);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);
  const isStreaming = useCodeStore((s) => s.isStreaming);
  const folder = useCodeStore((s) => s.folder);
  const permissionMode = useCodeStore((s) => s.permissionMode);
  const setModel = useCodeStore((s) => s.setModel);
  const setFolder = useCodeStore((s) => s.setFolder);
  const setPermissionMode = useCodeStore((s) => s.setPermissionMode);
  const addMessage = useCodeStore((s) => s.addMessage);
  const appendToLastAssistant = useCodeStore((s) => s.appendToLastAssistant);
  const addToolCall = useCodeStore((s) => s.addToolCall);
  const updateToolResult = useCodeStore((s) => s.updateToolResult);
  const startStreaming = useCodeStore((s) => s.startStreaming);
  const stopStreaming = useCodeStore((s) => s.stopStreaming);
  const setCurrentChat = useCodeStore((s) => s.setCurrentChat);
  const setSessionStatus = useCodeStore((s) => s.setSessionStatus);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const activeConvId = useConversationStore((s) => s.activeId);
  const allConversations = useConversationStore((s) => s.conversations);

  const isEmpty = messages.length === 0;

  const handleAttachmentAdd = useCallback(
    (file: AttachmentFile) => setAttachments((prev) => [...prev, file]),
    []
  );

  const handleAttachmentRemove = useCallback(
    (index: number) => setAttachments((prev) => prev.filter((_, i) => i !== index)),
    []
  );

  const { isDragging, dropZoneProps } = useFileDrop(handleAttachmentAdd);

  useEffect(() => {
    if (!activeConvId) return;
    const conv = allConversations.find((c) => c.id === activeConvId);
    if (conv?.surface === "code") setCurrentChat(activeConvId);
  }, [activeConvId, allConversations, setCurrentChat]);

  const { sendMessage, abort } = useSSEStream({
    onChunk(event) {
      switch (event.type) {
        case "text":
          appendToLastAssistant(chatId, (event.content as string) || "");
          break;
        case "thinking":
          appendToLastAssistant(chatId, "", (event.content as string) || "");
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
        case "error":
          appendToLastAssistant(
            chatId,
            `\n\n**Error:** ${(event.message as string) || "An error occurred"}`
          );
          break;
      }
    },
    onDone: () => {
      stopStreaming(chatId);
      setSessionStatus("idle");
    },
    onError: (error) => {
      stopStreaming(chatId);
      setSessionStatus("idle");
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
          surface: "code",
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
        attachments: attachments.length > 0 ? [...attachments] : undefined,
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
      setSessionStatus("streaming");
      setInputValue("");
      setAttachments([]);
      await sendMessage(trimmed, id, "code", model, {
        apiKey: nibGatewayApiKey || undefined,
      });
    },
    [
      chatId,
      model,
      attachments,
      addMessage,
      addConversation,
      setActiveConversation,
      setCurrentChat,
      startStreaming,
      sendMessage,
      setSessionStatus,
      updateConversation,
    ]
  );

  return (
    <div className="relative flex h-full flex-col bg-background" {...dropZoneProps}>
      <DropOverlay visible={isDragging} />

      {isEmpty ? (
        /* ── Empty state: centered mascot + input ── */
        <div className="flex flex-1 flex-col items-center justify-center px-6 animate-in fade-in duration-300">
          <Mascot />
          <div className="w-full max-w-2xl">
            <CodeInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              onAbort={abort}
              isStreaming={isStreaming}
              permissionMode={permissionMode}
              onPermissionModeChange={setPermissionMode}
              model={model}
              onModelChange={setModel}
              placeholder="Find a small todo in the codebase and do it"
              rows={2}
              minHeight="min-h-[72px]"
              attachments={attachments}
              onAttachmentAdd={handleAttachmentAdd}
              onAttachmentRemove={handleAttachmentRemove}
            />
            <BottomBar folder={folder} onFolderChange={setFolder} />
          </div>
        </div>
      ) : (
        /* ── Active state: messages + bottom input ── */
        <>
          <ScrollArea className="flex-1 px-6 py-4">
            <div className="max-w-3xl mx-auto">
              <TerminalOutput messages={messages as TerminalMessage[]} />
            </div>
          </ScrollArea>

          <div className="px-6 pb-4 pt-2">
            <div className="max-w-3xl mx-auto">
              <CodeInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleSubmit}
                onAbort={abort}
                isStreaming={isStreaming}
                permissionMode={permissionMode}
                onPermissionModeChange={setPermissionMode}
                model={model}
                onModelChange={setModel}
                placeholder="Describe a task..."
                rows={1}
                minHeight="min-h-[36px]"
                attachments={attachments}
                onAttachmentAdd={handleAttachmentAdd}
                onAttachmentRemove={handleAttachmentRemove}
              />
              <BottomBar folder={folder} onFolderChange={setFolder} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
