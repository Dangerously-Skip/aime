"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ModelSelector } from "@/components/shared/model-selector";
import { FolderPicker } from "@/components/shared/folder-picker";
import { ToolCallCard } from "@/components/shared/tool-call-card";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import { StreamingCursor } from "@/components/shared/streaming-cursor";
import { QuestionCard } from "@/components/shared/question-card";
import { AttachmentMenu } from "@/components/shared/attachment-menu";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { useFileDrop } from "@/hooks/use-file-drop";
import { useCodeStore, type PermissionMode } from "@/stores/code-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream, stripMessagesForHistory } from "@/hooks/use-sse-stream";
import { useMemoryStore } from "@/stores/memory-store";
import { formatMemoriesForPrompt } from "@/lib/memory/retriever";
import { handleMemoryExtractEvent } from "@/lib/memory/handle-extract-event";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { useProjectContext } from "@/hooks/use-project-context";
import { useAutoProject } from "@/hooks/use-auto-project";
import { useElectron } from "@/hooks/use-electron";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
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
  Folder,
  Globe,
} from "lucide-react";
import { PreviewPanel } from "@/components/shared/preview-panel";
import { PlanSheet } from "@/components/shared/plan-sheet";
import { ThinkingSection } from "@/components/shared/thinking-section";
import { VoiceButton } from "@/components/shared/voice-button";
import { EditorPicker } from "@/components/shared/editor-picker";
import { detectServerUrl, isWebAsset, findHtmlEntryPoint } from "@/lib/artifacts/server-detector";
import { executeToolInWebview, ConsoleLogBuffer, type WebviewRef } from "@/lib/browser-tools";
import type { Message } from "@/stores/chat-store";
import { ListChecks } from "lucide-react";

const EMPTY_MESSAGES: Message[] = [];

const THINKING_WORDS = [
  "Pondering",
  "Wibbling",
  "Puzzling",
  "Noodling",
  "Mulling",
  "Conjuring",
  "Ruminating",
  "Percolating",
  "Brainstorming",
  "Scheming",
  "Tinkering",
  "Contemplating",
];

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[rRf]+\s+|.*\/)/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+777\b/,
  /curl.*\|\s*(sh|bash)/,
  /wget.*\|\s*(sh|bash)/,
  /\bnc\s+-/,
];

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

/* ── Pixel mascot (jiggling character) ── */
function Mascot() {
  return (
    <img
      src="/mascot.svg"
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
  questionData?: unknown;
  questionToolUseId?: string;
  questionAnswered?: boolean;
}

function TerminalOutput({
  messages,
  onQuestionAnswered,
  onPreviewUrl,
  endRef,
}: {
  messages: TerminalMessage[];
  onQuestionAnswered?: (toolUseId: string, answers: Record<string, string>) => void;
  onPreviewUrl?: (url: string) => void;
  endRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [thinkingWordIndex, setThinkingWordIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_WORDS.length)
  );
  const hasLoading = messages.some((m) => m.isLoading && !m.content);

  useEffect(() => {
    if (!hasLoading) return;
    const interval = setInterval(() => {
      setThinkingWordIndex((i) => (i + 1) % THINKING_WORDS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [hasLoading]);

  return (
    <div className="space-y-3 text-sm">
      {messages.map((msg) => {
        if (msg.questionData) {
          return (
            <QuestionCard
              key={msg.id}
              toolUseId={msg.questionToolUseId || msg.id}
              questions={msg.questionData as Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }>}
              answered={msg.questionAnswered}
              onAnswer={onQuestionAnswered}
            />
          );
        }
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
              <ThinkingSection content={msg.thinking} isComplete={!msg.isStreaming} />
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
                onPreviewUrl={onPreviewUrl}
              />
            ))}
            {msg.content ? (
              <div className="pl-1">
                <MarkdownRenderer content={msg.content} />
                {msg.isStreaming && <StreamingCursor />}
              </div>
            ) : msg.isStreaming && !msg.isLoading ? (
              <div className="pl-1"><StreamingCursor /></div>
            ) : null}
            {msg.isLoading && !msg.content && (
              <div className="flex items-center gap-2 py-2 pl-1">
                <img
                  src="/starburst-logo.png"
                  alt="Loading"
                  width={22}
                  height={22}
                  className="loading-pulse"
                />
                <span className="text-sm text-muted-foreground thinking-word-fade">
                  {THINKING_WORDS[thinkingWordIndex]}...
                </span>
              </div>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
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
  currentProjectId,
  onAddToProject,
  onNewProject,
  projects,
  onVoiceTranscript,
  planButton,
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
  currentProjectId?: string | null;
  onAddToProject?: (projectId: string) => void;
  onNewProject?: () => void;
  projects?: { id: string; name: string; icon: string }[];
  onVoiceTranscript?: (text: string) => void;
  planButton?: React.ReactNode;
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
            currentProjectId={currentProjectId}
            onAddToProject={onAddToProject}
            onNewProject={onNewProject}
            projects={projects}
          />
          {onVoiceTranscript && <VoiceButton onTranscript={onVoiceTranscript} />}
          {planButton}

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

/* ── Bottom bar: folder + editor + connection ── */
function BottomBar({
  folder,
  onFolderChange,
}: {
  folder: string | null;
  onFolderChange: (f: string | null) => void;
}) {
  return (
    <div className="flex items-center justify-between px-1 pt-2">
      <div className="flex items-center gap-1">
        <FolderPicker
          folder={folder}
          onFolderChange={onFolderChange}
          className="border-0 bg-transparent shadow-none text-muted-foreground hover:text-foreground h-6 px-1"
        />
        <EditorPicker folder={folder} />
      </div>
      <ConnectionSelector />
    </div>
  );
}

/* ── Main surface ── */
export function CodeSurface() {
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const currentChatId = useCodeStore((s) => s.currentChatId);
  const chatId = currentChatId ?? "";
  const messages = useCodeStore(
    (s) =>
      (s.currentChatId ? s.messages[s.currentChatId] : undefined) ??
      EMPTY_MESSAGES
  );
  const model = useCodeStore((s) => s.model);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);
  const blockDangerousCommands = useSettingsStore((s) => s.blockDangerousCommands);
  const blockNetworkCommands = useSettingsStore((s) => s.blockNetworkCommands);
  const restrictToProjectFolder = useSettingsStore((s) => s.restrictToProjectFolder);
  const disableBashTool = useSettingsStore((s) => s.disableBashTool);
  const isStreaming = useCodeStore((s) => s.isStreaming);
  const folder = useCodeStore((s) => s.folder);
  const permissionMode = useCodeStore((s) => s.permissionMode);
  const planContent = useCodeStore((s) => (chatId ? s.planContent[chatId] : undefined));
  const planOpen = useCodeStore((s) => s.planOpen);
  const setPlanContent = useCodeStore((s) => s.setPlanContent);
  const setPlanOpen = useCodeStore((s) => s.setPlanOpen);
  const setModel = useCodeStore((s) => s.setModel);
  const setFolder = useCodeStore((s) => s.setFolder);
  const setPermissionMode = useCodeStore((s) => s.setPermissionMode);
  const addMessage = useCodeStore((s) => s.addMessage);
  const appendToLastAssistant = useCodeStore((s) => s.appendToLastAssistant);
  const addToolCall = useCodeStore((s) => s.addToolCall);
  const updateMessage = useCodeStore((s) => s.updateMessage);
  const updateToolResult = useCodeStore((s) => s.updateToolResult);
  const completeRunningTools = useCodeStore((s) => s.completeRunningTools);
  const startStreaming = useCodeStore((s) => s.startStreaming);
  const stopStreaming = useCodeStore((s) => s.stopStreaming);
  const setCurrentChat = useCodeStore((s) => s.setCurrentChat);
  const setSessionStatus = useCodeStore((s) => s.setSessionStatus);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const activeConvId = useConversationStore((s) => s.activeId);
  const allConversations = useConversationStore((s) => s.conversations);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const previewWebviewRef = useRef<WebviewRef | null>(null);
  const consoleBufferRef = useRef(new ConsoleLogBuffer());
  // Track HTML file paths written during this stream for preview detection
  const pendingHtmlFiles = useRef<string[]>([]);
  // Track non-HTML web asset files for entry point resolution
  const pendingWebAssets = useRef<string[]>([]);
  // Debounce timer for auto-refresh
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced refresh when non-HTML files are written alongside the current preview
  const triggerPreviewRefresh = useCallback((filePath: string) => {
    if (!previewUrl || !previewUrl.startsWith("file://")) return;
    const previewDir = previewUrl.replace("file://", "").substring(0, previewUrl.replace("file://", "").lastIndexOf("/"));
    const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));
    // Refresh if the written file is in the same directory (or a subdirectory) of the preview file
    if (fileDir.startsWith(previewDir)) {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        setRefreshKey((k) => k + 1);
      }, 500);
    }
  }, [previewUrl]);

  // Helper to resolve entry point from pending web assets
  const resolveWebAssetEntryPoint = useCallback(async () => {
    if (pendingWebAssets.current.length === 0) return;
    const lastAsset = pendingWebAssets.current[pendingWebAssets.current.length - 1];
    const rootDir = folder || lastAsset.substring(0, lastAsset.lastIndexOf("/"));
    const htmlPath = await findHtmlEntryPoint(lastAsset, rootDir);
    if (htmlPath) {
      setPreviewUrl(`file://${htmlPath}`);
    }
    pendingWebAssets.current = [];
  }, [folder]);

  const { projectId: currentProjectId } = useProjectContext(chatId, "code");
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const { handleFolderSelected } = useAutoProject('code');
  const { isElectron, selectFolder: pickFolder, showNotification } = useElectron();
  const isEmpty = messages.length === 0;

  const handleFolderChange = useCallback(
    (f: string | null) => {
      setFolder(f);
      if (f && chatId) {
        handleFolderSelected(f, chatId);
      }
    },
    [setFolder, chatId, handleFolderSelected]
  );

  const handleQuestionAnswered = useCallback(
    (toolUseId: string) => {
      if (chatId) updateMessage(chatId, toolUseId, { questionAnswered: true });
    },
    [chatId, updateMessage]
  );

  // Auto-scroll
  const endRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const userScrolledUpRef = useRef(false);

  // Auto-scroll via ResizeObserver — fires on any content size change
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (!userScrolledUpRef.current) {
        requestAnimationFrame(() => {
          endRef.current?.scrollIntoView({ behavior: "instant" });
        });
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Scroll to bottom on conversation switch
  useEffect(() => {
    if (messages.length > 0) {
      userScrolledUpRef.current = false;
      setUserScrolledUp(false);
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
  }, [messages.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

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
        case "turn_start":
          // A new assistant turn means previous turn's tools have all executed.
          // Mark any still-running tools as complete and check for HTML previews.
          completeRunningTools(chatId);
          if (pendingHtmlFiles.current.length > 0) {
            const lastHtml = pendingHtmlFiles.current[pendingHtmlFiles.current.length - 1];
            setPreviewUrl(`file://${lastHtml}`);
            pendingHtmlFiles.current = [];
            pendingWebAssets.current = [];
          } else if (pendingWebAssets.current.length > 0) {
            resolveWebAssetEntryPoint();
          }
          break;
        case "text":
          appendToLastAssistant(chatId, (event.content as string) || "");
          break;
        case "thinking":
          appendToLastAssistant(chatId, "", (event.content as string) || "");
          break;
        case "tool_use": {
          const toolName = (event.name as string) || "Unknown";
          const toolInput = (event.input as Record<string, unknown>) || {};
          const toolCallData: {
            id: string;
            name: string;
            input: Record<string, unknown>;
            status: "running";
            startTime: number;
          } = {
            id: (event.id as string) || `tool_${Date.now()}`,
            name: toolName,
            input: toolInput,
            status: "running",
            startTime: Date.now(),
          };
          // Tag dangerous Bash commands with a warning
          if (
            toolName === "Bash" &&
            typeof toolInput.command === "string" &&
            isDangerousCommand(toolInput.command) &&
            (useSettingsStore.getState().blockDangerousCommands || useSettingsStore.getState().blockNetworkCommands)
          ) {
            toolCallData.input = { ...toolInput, __securityWarning: true };
          }
          addToolCall(chatId, toolCallData);
          // Register Write/Edit artifacts with project and track HTML/web asset files
          if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
            const filePath = (toolInput.file_path || toolInput.notebook_path) as string | undefined;
            if (filePath) {
              if (/\.html?$/i.test(filePath)) {
                pendingHtmlFiles.current.push(filePath);
              } else if (isWebAsset(filePath)) {
                pendingWebAssets.current.push(filePath);
                // Auto-refresh if we already have a file:// preview open
                triggerPreviewRefresh(filePath);
              }
              if (currentProjectId) {
                const fileName = filePath.split("/").pop() || filePath;
                useProjectStore.getState().addArtifact(currentProjectId, {
                  id: crypto.randomUUID(),
                  name: fileName,
                  path: filePath,
                  type: "file",
                  surface: "code",
                  conversationId: chatId,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                });
              }
            }
          }
          // Detect plan file writes
          if (toolName === "Write" && chatId) {
            const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "";
            if (filePath.includes(".claude/plans/")) {
              const content = typeof toolInput.content === "string" ? toolInput.content : "";
              if (content) setPlanContent(chatId, content);
            }
          }
          break;
        }
        case "tool_result": {
          const toolResultId = (event.tool_use_id as string) || (event.id as string) || "";
          const toolResult =
            typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
          updateToolResult(chatId, toolResultId, toolResult, event.is_error as boolean | undefined);
          if (toolResult && !event.is_error) {
            const detected = detectServerUrl(toolResult);
            if (detected) setPreviewUrl(detected.url);
          }
          break;
        }
        case "browser_tool_use": {
          const browserToolId = event.toolUseId as string;
          const browserToolName = event.name as string;
          const browserToolInput = (event.input as Record<string, unknown>) || {};

          // Show tool call in UI
          addToolCall(chatId, {
            id: browserToolId,
            name: browserToolName,
            input: browserToolInput,
            status: "running",
            startTime: Date.now(),
          });

          // Execute in preview webview and POST result back (async, non-blocking)
          const wv = previewWebviewRef.current;
          if (!wv) {
            const errOutput = 'Preview panel is not open. Write an HTML file or start a dev server first.';
            updateToolResult(chatId, browserToolId, errOutput, true);
            fetch('/api/chat/browser-tool-result', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ toolUseId: browserToolId, output: errOutput, isError: true }),
            }).catch((err) => console.error('[CodeSurface] Failed to POST browser tool result:', err));
          } else {
            executeToolInWebview(wv, browserToolName, browserToolInput, consoleBufferRef.current)
              .then((browserResult) => {
                updateToolResult(chatId, browserToolId, browserResult.message, !browserResult.success);
                return fetch('/api/chat/browser-tool-result', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ toolUseId: browserToolId, output: browserResult.message, isError: !browserResult.success }),
                });
              })
              .catch((err) => {
                const errMsg = err instanceof Error ? err.message : String(err);
                updateToolResult(chatId, browserToolId, `Browser tool error: ${errMsg}`, true);
                fetch('/api/chat/browser-tool-result', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ toolUseId: browserToolId, output: `Browser tool error: ${errMsg}`, isError: true }),
                }).catch(() => {});
              });
          }
          break;
        }
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
    onDone: () => {
      // Mark any remaining running tools as complete
      completeRunningTools(chatId);
      // Set preview URL for any HTML files written in the last turn
      if (pendingHtmlFiles.current.length > 0) {
        const lastHtml = pendingHtmlFiles.current[pendingHtmlFiles.current.length - 1];
        setPreviewUrl(`file://${lastHtml}`);
        pendingHtmlFiles.current = [];
        pendingWebAssets.current = [];
      } else if (pendingWebAssets.current.length > 0) {
        resolveWebAssetEntryPoint();
      }
      stopStreaming(chatId);
      setSessionStatus("idle");
      // Inline plan detection: check last assistant message for plan heading
      const allMsgs = useCodeStore.getState().messages[chatId];
      const lastMsg = allMsgs?.at(-1);
      if (lastMsg?.role === "assistant" && lastMsg.content && /^#{1,2}\s+plan\b/im.test(lastMsg.content.slice(0, 500))) {
        setPlanContent(chatId, lastMsg.content);
      }
      if (!document.hasFocus()) {
        showNotification("Task complete", "Claude has finished working on your request.");
      }
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
        // Auto-associate with project when conversation is first created
        if (folder) {
          handleFolderSelected(folder, id);
        }
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
      // Grab prior messages for history fallback (exclude just-added user + assistant placeholder)
      const priorMessages = useCodeStore.getState().messages[id] || [];
      const history = stripMessagesForHistory(priorMessages.slice(0, -2));

      // Retrieve relevant memories — scope to current project so memories from
      // other folders don't leak into the conversation context.
      const relevantMemories = useMemoryStore.getState().getMemoriesForContext({
        query: trimmed,
        projectId: useConversationStore.getState().conversations.find((c) => c.id === id)?.projectId ?? null,
      });
      const memoriesStr = formatMemoriesForPrompt(relevantMemories);
      relevantMemories.forEach((m) => useMemoryStore.getState().touchMemory(m.id));

      await sendMessage(trimmed, id, "code", model, {
        apiKey: nibGatewayApiKey || undefined,
        cwd: folder || undefined,
        history: history.length > 0 ? history : undefined,
        memories: memoriesStr || undefined,
        securitySettings: {
          blockDangerousCommands,
          blockNetworkCommands,
          restrictToProjectFolder,
          disableBashTool,
        },
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

  const handleVoiceTranscript = useCallback(
    (text: string) => setInputValue((prev) => (prev ? `${prev} ${text}` : text)),
    []
  );

  const planButton = planContent ? (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => setPlanOpen(true)}
    >
      <ListChecks className="h-3.5 w-3.5" />
      Plan
    </Button>
  ) : null;

  return (
    <div className="relative flex h-full flex-col bg-background" {...dropZoneProps}>
      <DropOverlay visible={isDragging} />

      {isEmpty ? (
        /* ── Empty state: centered mascot + input (or folder prompt) ── */
        <div className="flex flex-1 flex-col items-center justify-center px-6 animate-in fade-in duration-300">
          <Mascot />
          <div className="w-full max-w-2xl">
            {folder ? (
              <>
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
                  currentProjectId={currentProjectId}
                  onAddToProject={(pid) => assignToProject(chatId, pid)}
                  onNewProject={() => setSidebarMode("projects")}
                  projects={allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
                  onVoiceTranscript={handleVoiceTranscript}
                  planButton={planButton}
                />
                <BottomBar folder={folder} onFolderChange={handleFolderChange} />
              </>
            ) : (
              <div className="rounded-2xl border border-border bg-card shadow-sm p-8 text-center">
                <Folder className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <h2 className="text-lg font-medium mb-1">Select a folder to start coding</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  Choose a project folder so Claude knows where to read and write files.
                </p>
                <FolderPicker
                  folder={folder}
                  onFolderChange={handleFolderChange}
                  className="mx-auto"
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Active state: messages + bottom input ── */
        <>
          {/* Continue in Surface handoff (when project is active) */}
          {currentProjectId && !isStreaming && messages.length > 0 && (
            <div className="flex items-center gap-2 px-6 py-1.5 border-b border-border/50">
              <span className="text-xs text-muted-foreground">Continue in:</span>
              <ContinueInSurface
                currentSurface="code"
                projectId={currentProjectId}
                conversationId={chatId}
              />
            </div>
          )}

          {/* Preview chip header */}
          {previewUrl && (
            <div className="flex items-center gap-2 px-6 py-1.5 border-b border-border/50">
              <button
                type="button"
                onClick={() => setPreviewOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
              >
                <Globe className="h-3 w-3" />
                <span>Preview</span>
                <span className="text-primary/70 font-mono truncate max-w-[200px]">
                  {previewUrl.replace(/^https?:\/\//, "")}
                </span>
              </button>
            </div>
          )}

          <div className="flex flex-1 min-h-0">
            {/* Messages + input column */}
            <div className="flex flex-1 flex-col min-w-0">
              <div
                className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const scrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight >= 50;
                  setUserScrolledUp(scrolledUp);
                  userScrolledUpRef.current = scrolledUp;
                }}
              >
                <div ref={contentRef} className="max-w-3xl mx-auto relative">
                  <TerminalOutput
                    messages={messages as TerminalMessage[]}
                    onQuestionAnswered={handleQuestionAnswered}
                    onPreviewUrl={(url) => { setPreviewUrl(url); setPreviewOpen(true); }}
                    endRef={endRef}
                  />
                </div>
                {userScrolledUp && (
                  <button
                    onClick={() => {
                      setUserScrolledUp(false);
                      userScrolledUpRef.current = false;
                      endRef.current?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 rounded-full bg-primary/90 text-primary-foreground px-3 py-1.5 text-xs shadow-lg hover:bg-primary transition-colors"
                  >
                    Scroll to bottom
                  </button>
                )}
              </div>

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
                    currentProjectId={currentProjectId}
                    onAddToProject={(pid) => assignToProject(chatId, pid)}
                    onNewProject={() => setSidebarMode("projects")}
                    projects={allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
                    onVoiceTranscript={handleVoiceTranscript}
                    planButton={planButton}
                  />
                  <BottomBar folder={folder} onFolderChange={handleFolderChange} />
                </div>
              </div>
            </div>

            {/* Preview panel */}
            {previewUrl && (
              <PreviewPanel
                url={previewUrl}
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                refreshKey={refreshKey}
                onWebviewReady={(ref) => { previewWebviewRef.current = ref as WebviewRef | null; }}
                onConsoleMessage={(level, message) => { consoleBufferRef.current.push(level, message); }}
              />
            )}
          </div>
        </>
      )}

      {/* Plan sheet */}
      <PlanSheet
        content={planContent}
        open={planOpen}
        onClose={() => setPlanOpen(false)}
      />
    </div>
  );
}
