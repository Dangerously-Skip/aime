"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ModelSelector } from "@/components/shared/model-selector";
import { FolderPicker } from "@/components/shared/folder-picker";
import { CloneFromGitHub } from "@/components/shared/clone-from-github";
import { useConnectorStore } from "@/stores/connector-store";
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
import { useSearchSettings } from '@/hooks/use-search-settings'
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream, stripMessagesForHistory } from "@/hooks/use-sse-stream";
import { handleAgnosticChunk } from "@/lib/sse/agnostic-chunks";
import { handleCoreChunk } from "@/lib/sse/core-chunks";
import { watchStuckTool } from "@/lib/stuck-tool-watchdog";
import { useDocumentPrint } from "@/hooks/use-document-print";
import { useCanvasSseHandler } from "@/hooks/use-canvas-sse-handler";
import { useMemoryStore } from "@/stores/memory-store";
import { formatMemoriesForPrompt } from "@/lib/memory/retriever";
import { handleMemoryExtractEvent } from "@/lib/memory/handle-extract-event";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { useProjectContext } from "@/hooks/use-project-context";
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
  Github,
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
import { CommandPicker, type CommandSuggestion } from "@/components/shared/command-picker";
import { getSlashSuggestions, parseSlashCommand, applySlashCommand, DEFAULT_SESSION_CONTROLS } from "@/lib/slash-commands";
import { useAtSuggestions, getAtQuery, removeAtQuery } from "@/hooks/use-at-suggestions";
import { WorkspaceLayout } from "./workspace/workspace-layout";
import { useProviderStore } from "@/stores/provider-store";
import { resolveSendRoute } from "@/lib/models/client-options";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useTurnWiring } from "@/hooks/use-turn-wiring";
import { useBuiltinAccess } from "@/hooks/use-builtin-access";
import { handleWidgetCreateEvent } from "@/lib/widgets/handle-create-event";

/** This surface's routing capability — a fixed property of the surface. */
const CAPABILITY = getSurfaceRoute("code").capability;

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

/** PERMISSION_MODES[0] is the "default" (ask) mode, so it doubles as the fallback. */
function getPermissionMode(mode: PermissionMode) {
  return PERMISSION_MODES.find((m) => m.value === mode) ?? PERMISSION_MODES[0];
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
  attachments?: Array<{ name: string; category: string }>;
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
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1 ml-4">
                  {msg.attachments.map((att: { name: string; category: string }, i: number) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground font-sans">
                      {att.name}
                    </span>
                  ))}
                </div>
              )}
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
  onSelectModel,
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
  cwd,
  onSlashCommand,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onAbort?: () => void;
  isStreaming: boolean;
  cwd?: string | null;
  onSlashCommand?: (text: string) => boolean;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  model: string;
  /** Legacy built-in enum setter; selections are recorded as routes now. */
  onModelChange?: (model: string) => void;
  onSelectModel?: (opt: import('@/lib/models/client-options').ModelOption) => void;
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
  // Held as the config object (not a bare component) so the icon renders through
  // a stable module-level reference rather than a locally-created component.
  const permMode = getPermissionMode(permissionMode);
  const [cmdSuggestions, setCmdSuggestions] = useState<CommandSuggestion[]>([]);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(0);
  const { fileSuggestions, fetchAtSuggestions, clearAtSuggestions, resolveFileAsAttachment } =
    useAtSuggestions();

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
      onChange(s.value + ' ');
      setCmdSuggestions([]);
    } else {
      const newVal = removeAtQuery(value);
      onChange(newVal);
      clearAtSuggestions();
      resolveFileAsAttachment(s.value).then((att) => {
        if (att) onAttachmentAdd(att);
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
        onAbort?.();
      } else if (value.trim()) {
        // Let parent handle slash commands
        if (onSlashCommand && onSlashCommand(value.trim())) return;
        onSubmit(value.trim());
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    onChange(val);
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

    // @ suggestions
    const atQ = getAtQuery(val);
    if (atQ !== null && cwd) {
      fetchAtSuggestions(atQ, cwd);
    } else {
      clearAtSuggestions();
    }

    setSelectedSuggestionIdx(0);
  }

  function handleButtonClick() {
    if (isStreaming) {
      onAbort?.();
    } else if (value.trim()) {
      if (onSlashCommand && onSlashCommand(value.trim())) return;
      onSubmit(value.trim());
    }
  }

  return (
    <div>
    <CommandPicker
      suggestions={activeSuggestions}
      selectedIndex={selectedSuggestionIdx}
      onSelect={handleSelectSuggestion}
      onSelectedIndexChange={setSelectedSuggestionIdx}
    />
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
                  <permMode.icon className="h-3.5 w-3.5" />
                  <span>{permMode.label}</span>
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
            onSelectModel={onSelectModel}
            capability={CAPABILITY}
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
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const currentChatId = useCodeStore((s) => s.currentChatId);
  const chatId = currentChatId ?? "";
  // Both were absent entirely; see the relay note in the onChunk handler.
  const printDocument = useDocumentPrint();
  const onCanvasEvent = useCanvasSseHandler("code", chatId);
  const messages = useCodeStore(
    (s) =>
      (s.currentChatId ? s.messages[s.currentChatId] : undefined) ??
      EMPTY_MESSAGES
  );
  const modelRoute = useCodeStore((s) => s.modelRoute);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  /** Sent with every turn; without it the server never learns search exists. */
  const searchSettings = useSearchSettings();
  // Built-in (Claude) reachability, which is the user's key OR the server's env
  // key OR Bedrock — `anthropicApiKey` alone only knows about the first.
  const { hasAnthropicKey, hasBedrock, known: builtinAccessKnown } = useBuiltinAccess();
  const tierModels = useSettingsStore((s) => s.tierModels);
  const providers = useProviderStore((s) => s.providers);
  const blockDangerousCommands = useSettingsStore((s) => s.blockDangerousCommands);
  const blockNetworkCommands = useSettingsStore((s) => s.blockNetworkCommands);
  const restrictToProjectFolder = useSettingsStore((s) => s.restrictToProjectFolder);
  const disableBashTool = useSettingsStore((s) => s.disableBashTool);
  const isStreaming = useCodeStore((s) => s.isStreaming);
  const storeFolder = useCodeStore((s) => chatId ? s.folderByChat[chatId] ?? null : null);
  const folder = storeFolder || pendingFolder;
  const permissionMode = useCodeStore((s) => s.permissionMode);
  const planContent = useCodeStore((s) => (chatId ? s.planContent[chatId] : undefined));
  const planOpen = useCodeStore((s) => s.planOpen);
  const setPlanContent = useCodeStore((s) => s.setPlanContent);
  const setPlanOpen = useCodeStore((s) => s.setPlanOpen);
  const sessionControls = useCodeStore(
    (s) => (chatId ? s.sessionControls[chatId] : undefined) ?? DEFAULT_SESSION_CONTROLS
  );
  const setSessionControls = useCodeStore((s) => s.setSessionControls);
  const setModelRoute = useCodeStore((s) => s.setModelRoute);
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
  const setIsStreaming = useCodeStore((s) => s.setIsStreaming);
  const setSessionStatus = useCodeStore((s) => s.setSessionStatus);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const activeConvId = useConversationStore((s) => s.activeId);
  const allConversations = useConversationStore((s) => s.conversations);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const githubConnected = useConnectorStore(
    (s) => s.connectorStates['github']?.authenticated && !!s.tokens['github']
  );
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
  // Auto-project creation disabled — users create projects manually
  const { showNotification } = useElectron();
  const isEmpty = messages.length === 0;

  const handleFolderChange = useCallback(
    (f: string | null) => {
      if (chatId) {
        setFolder(chatId, f);
      } else {
        setPendingFolder(f);
      }
    },
    [setFolder, chatId]
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

  const ownsChat = useCallback(
    (id: string) => !!useCodeStore.getState().messages[id]?.length,
    [],
  );
  // Run recording + the card-answer persisters, shared with the other three
  // surfaces (see use-turn-wiring). This surface renders no connect card, so
  // `onConnectorSettled` goes unused rather than being a fourth copy waiting to
  // be needed.
  const { runRecorder, onQuestionAnswered } = useTurnWiring({
    surfaceId: "code",
    chatId,
    ownsChat,
    updateMessage,
  });

  const { sendMessage, abort } = useSSEStream({
    chatId,
    setIsStreaming,
    onUsage: runRecorder.onUsage,
    onChunk(event) {
      // Chunks whose handling is the same on every surface — cron jobs,
      // standing orders, widgets, memory. Handled in ONE place
      // (lib/sse/agnostic-chunks) because each surface having its own case
      // meant three of them were silently dropped on most surfaces.
      if (handleAgnosticChunk(event, { chatId: chatId, surface: 'Code' })) return;

      // The chunks whose handling is identical across surfaces, recorded once in
      // lib/sse/core-chunks. `skip` names what this surface still owns — see the
      // note there; it is a visible migration step, not a permanent carve-out.
      if (
        handleCoreChunk(event, {
          chatId: chatId,
          store: { addMessage, appendToLastAssistant, addToolCall, updateToolResult, completeRunningTools },
          // Code had NONE of the three relay handlers. Each one pauses the turn
          // server-side, so their absence was not a missing feature — a connector
          // request stalled for 300s and a document print for 60s before timing
          // out, with nothing on screen to explain it.
          printDocument,
          onCanvas: onCanvasEvent,
          notify: (title, body) => {
            if (!document.hasFocus()) showNotification(title, body);
          },
          // The watchdog cowork has had all along. Code runs the longest tools of
          // any surface and had no protection from one that stops progressing.
          watchTool: (toolId, toolName) =>
            watchStuckTool({
              chatId,
              toolId,
              toolName,
              getToolStatus: () =>
                useCodeStore.getState().messages[chatId]?.at(-1)?.toolCalls?.find((t) => t.id === toolId)?.status,
              subscribe: (listener) => useCodeStore.subscribe(listener),
            }),
          skip: ['tool_use', 'tool_result'],
        })
      ) {
        return;
      }

      switch (event.type) {
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
      }
    },
    onDone: () => {
      runRecorder.succeed();
      // Mark any remaining running tools as complete
      completeRunningTools(chatId);
      // Set preview URL for any HTML files written in the last turn and auto-open preview
      if (pendingHtmlFiles.current.length > 0) {
        const lastHtml = pendingHtmlFiles.current[pendingHtmlFiles.current.length - 1];
        setPreviewUrl(`file://${lastHtml}`);
        setPreviewOpen(true);
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
      runRecorder.fail(error.message);
      stopStreaming(chatId);
      setSessionStatus("idle");
      appendToLastAssistant(chatId, `\n\n**Error:** ${error.message}`);
    },
  });

  // Returns true if handled as slash command (caller should not submit)
  const handleSlashCommand = useCallback(
    (text: string): boolean => {
      const parsed = parseSlashCommand(text);
      if (!parsed) return false;
      const result = applySlashCommand(parsed, sessionControls);
      if (!result) return false;
      const effectiveId = chatId || (() => {
        const id = crypto.randomUUID();
        addConversation({ id, title: text.substring(0, 50), surface: 'code', lastMessage: text, createdAt: Date.now(), updatedAt: Date.now() });
        setActiveConversation(id);
        setCurrentChat(id);
        return id;
      })();
      setSessionControls(effectiveId, result.controls);
      addMessage(effectiveId, { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now() });
      addMessage(effectiveId, { id: crypto.randomUUID(), role: 'assistant', content: result.message, timestamp: Date.now() });
      setInputValue('');
      return true;
    },
    [chatId, sessionControls, setSessionControls, addMessage, addConversation, setActiveConversation, setCurrentChat]
  );

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
        // Apply pending folder selection from before conversation was created
        if (pendingFolder) {
          setFolder(id, pendingFolder);
          setPendingFolder(null);
        }
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

      const currentControls = useCodeStore.getState().sessionControls[id] ?? sessionControls;
      const currentAttachments = [...attachments];
      setAttachments([]);

      // Drain context bus events for this surface
      const { useContextBusStore } = await import('@/stores/context-bus-store');
      const busEvents = useContextBusStore.getState().getUnconsumed('code')
        .filter(e => e.priority === 'p0' || e.priority === 'p1')
        .map(e => ({ summary: e.summary, source: e.source, priority: e.priority }));
      if (busEvents.length > 0) {
        useContextBusStore.getState().consumeAll('code');
      }

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
      runRecorder.begin({ trigger: "manual", model: route?.model ?? undefined });
      await sendMessage(trimmed, id, "code", route?.model ?? null, {
        apiKey: anthropicApiKey || undefined,
        providerConfig: route?.providerConfig,
        cwd: folder || undefined,
        history: history.length > 0 ? history : undefined,
        memories: memoriesStr || undefined,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        contextBusEvents: busEvents.length > 0 ? busEvents : undefined,
        sessionControls: currentControls,
        securitySettings: {
          blockDangerousCommands,
          blockNetworkCommands,
          restrictToProjectFolder,
          disableBashTool,
        },
        searchSettings,
      });
    },
    [
      chatId,
      runRecorder,
      modelRoute,
      providers,
      tierModels,
      anthropicApiKey,
      hasAnthropicKey,
      hasBedrock,
      builtinAccessKnown,
      folder,
      attachments,
      addMessage,
      addConversation,
      setActiveConversation,
      setCurrentChat,
      startStreaming,
      sendMessage,
      setSessionStatus,
      updateConversation,
      // Read inside the callback and previously missing, so a slash command or a
      // security-setting change did not take effect until another dep changed.
      // All are primitives or stable store references.
      sessionControls,
      pendingFolder,
      setFolder,
      blockDangerousCommands,
      blockNetworkCommands,
      restrictToProjectFolder,
      disableBashTool,
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
                  model={modelRoute?.id ?? ''}
                  onSelectModel={setModelRoute}
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
                  cwd={folder}
                  onSlashCommand={handleSlashCommand}
                />
                <BottomBar folder={folder} onFolderChange={handleFolderChange} />
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-border bg-card shadow-sm p-8 text-center">
                  <Folder className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  <h2 className="text-lg font-medium mb-1">Start coding</h2>
                  <p className="text-sm text-muted-foreground mb-5">
                    Pick a folder to work in — or clone a GitHub repo.
                  </p>
                  <div className="flex flex-col items-center gap-2">
                    <FolderPicker
                      folder={folder}
                      onFolderChange={handleFolderChange}
                      className="mx-auto"
                    />
                    {githubConnected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCloneDialogOpen(true)}
                      >
                        <Github className="h-3.5 w-3.5 mr-1.5" />
                        Clone from GitHub
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        Connect GitHub in <span className="font-medium">Customize → Connectors</span> to enable repo cloning.
                      </p>
                    )}
                  </div>
                </div>
                <CloneFromGitHub
                  open={cloneDialogOpen}
                  onOpenChange={setCloneDialogOpen}
                  onCloned={(path) => handleFolderChange(path)}
                />
              </>
            )}
          </div>
        </div>
      ) : (
        /* ── Active state: workspace layout (tree + viewer + chat slot) ── */
        <WorkspaceLayout
          workspace={folder}
          slots={{
            chat: (
              <div className="flex flex-col h-full min-h-0">
                {/* Continue in Surface handoff (when project is active) */}
                {currentProjectId && !isStreaming && messages.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 shrink-0">
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
                  <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewOpen((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary hover:bg-primary/10 transition-colors animate-in fade-in slide-in-from-left-2 duration-300"
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
                      className="flex-1 min-h-0 overflow-y-auto px-4 py-4"
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
                          onQuestionAnswered={onQuestionAnswered}
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

                    <div className="px-4 pb-3 pt-2 shrink-0">
                      <div className="max-w-3xl mx-auto">
                        <CodeInput
                          value={inputValue}
                          onChange={setInputValue}
                          onSubmit={handleSubmit}
                          onAbort={abort}
                          isStreaming={isStreaming}
                          permissionMode={permissionMode}
                          onPermissionModeChange={setPermissionMode}
                          model={modelRoute?.id ?? ''}
                          onSelectModel={setModelRoute}
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
              </div>
            ),
          }}
        />
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
