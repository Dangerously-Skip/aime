"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MessageList } from "@/components/shared/message-list";
import { ModelSelector } from "@/components/shared/model-selector";
import { FolderPicker } from "@/components/shared/folder-picker";
import { AttachmentMenu } from "@/components/shared/attachment-menu";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { useCoworkStore } from "@/stores/cowork-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream, stripMessagesForHistory } from "@/hooks/use-sse-stream";
import { useProjectContext } from "@/hooks/use-project-context";
import { useMemoryStore } from "@/stores/memory-store";
import { formatMemoriesForPrompt } from "@/lib/memory/retriever";
import { handleMemoryExtractEvent } from "@/lib/memory/handle-extract-event";
import { summarizeConversation } from "@/lib/memory/summarizer";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { useAutoProject } from "@/hooks/use-auto-project";
import { sendConversationCompletedEvent } from "@/lib/telemetry/events";
import { useCronStore } from "@/stores/cron-store";
import { useScratchDir } from "@/hooks/use-scratch-dir";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
import { useFileDrop } from "@/hooks/use-file-drop";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { Message } from "@/stores/chat-store";
import { FilePreviewSheet } from "@/components/shared/file-preview-sheet";
import { PlanSheet } from "@/components/shared/plan-sheet";
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
  Globe,
  ListChecks,
} from "lucide-react";
import { PreviewPanel } from "@/components/shared/preview-panel";
import { CanvasPanel } from "@/components/shared/canvas-panel";
import { detectServerUrl } from "@/lib/artifacts/server-detector";
import { useElectron } from "@/hooks/use-electron";
import { VoiceButton } from "@/components/shared/voice-button";
import { EditorPicker } from "@/components/shared/editor-picker";
import { useCanvasStore } from "@/stores/canvas-store";
import type { A2UIDocument } from "@/lib/a2ui/types";
import { useHeartbeat } from "@/hooks/use-heartbeat";
import { useCron } from "@/hooks/use-cron";
import { useReminderStore, playDing } from "@/stores/reminder-store";
import { useHeartbeatStore } from "@/stores/heartbeat-store";
import { CommandPicker, type CommandSuggestion } from "@/components/shared/command-picker";
import {
  parseSlashCommand,
  applySlashCommand,
  getSlashSuggestions,
  DEFAULT_SESSION_CONTROLS,
} from "@/lib/slash-commands";
import { useAtSuggestions, getAtQuery, removeAtQuery } from "@/hooks/use-at-suggestions";

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_FILES: string[] = [];

/** Truncate text at the nearest word boundary before maxLen. */
function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.substring(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.5 ? truncated.substring(0, lastSpace) : truncated;
}

// Bash patterns that indicate file creation/modification (capture group 1 = output path)
const BASH_WRITE_PATTERNS = [
  /(?<![0-9&])>\s*(?!&|\s*$)(\S+)/,    // echo "x" > file, cat > file (skip 2>&1, >&2)
  /tee\s+(?:-a\s+)?(\S+)/,             // tee file, tee -a file
  /cp\s+\S+\s+(\S+)/,                  // cp src dest
  /mv\s+\S+\s+(\S+)/,                  // mv src dest
  /mkdir\s+(?:-p\s+)?(\S+)/,           // mkdir -p dir
  /touch\s+(\S+)/,                      // touch file
];

// Bash commands that are noisy / not worth tracking in sidebar
const BASH_NOISE = /^\s*(ls|cd|pwd|echo(?!\s.*>)|git\s+(status|log|diff|branch|show)|cat\s|head\s|tail\s|wc\s|which\s|type\s|env|printenv|date|whoami|uname)/;

// Binary/document extensions that Bash scripts produce (not tracked by Write/Edit tools)
const BASH_ARTIFACT_EXT = /\b([\w./-]+\.(?:pptx?|docx?|xlsx?|pdf|csv|png|jpe?g|gif|svg|webp|mp[34]|wav|ogg|zip|tar\.gz|tgz))\b/gi;

function categorizeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
): { category: "context" | "artifact"; path: string } | null {
  // spawn_agent — show as context entry
  if (toolName === "spawn_agent") {
    const agentName = typeof toolInput.agentName === "string" ? toolInput.agentName : null;
    const task = typeof toolInput.task === "string" ? toolInput.task : "";
    const label = agentName
      ? `⚡ ${agentName}: ${task.slice(0, 40)}${task.length > 40 ? "…" : ""}`
      : `⚡ subagent: ${task.slice(0, 40)}${task.length > 40 ? "…" : ""}`;
    return { category: "context", path: label };
  }

  // Explicit artifact tools
  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit" ||
      toolName === "ExcelWrite" || toolName === "ExcelEdit" ||
      toolName.endsWith("__ExcelWrite") || toolName.endsWith("__ExcelEdit") ||
      toolName.endsWith(":ExcelWrite") || toolName.endsWith(":ExcelEdit")) {
    const raw = toolInput.file_path || toolInput.path || toolInput.notebook_path;
    return typeof raw === "string" ? { category: "artifact", path: raw } : null;
  }

  // Explicit context tools
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep" ||
      toolName === "WebSearch" || toolName === "WebFetch" ||
      toolName === "ExcelRead" || toolName.endsWith("__ExcelRead") || toolName.endsWith(":ExcelRead")) {
    const raw = toolInput.file_path || toolInput.path || toolInput.pattern || toolInput.url || toolInput.query;
    return typeof raw === "string" ? { category: "context", path: raw } : null;
  }

  // Bash — inspect command to decide
  if (toolName === "Bash") {
    const cmd = typeof toolInput.command === "string" ? toolInput.command : "";
    if (!cmd) return null;

    // Check if it's a file-creation command
    for (const pat of BASH_WRITE_PATTERNS) {
      const m = cmd.match(pat);
      if (m?.[1]) {
        const p = m[1].replace(/['"]/g, "");
        // Skip non-file targets
        if (p === "/dev/null" || p.startsWith("&") || /^[0-9]+$/.test(p)) continue;
        return { category: "artifact", path: p };
      }
    }

    // Skip noisy read/explore commands
    if (BASH_NOISE.test(cmd)) return null;

    // Other Bash commands — context with a short description of the command
    const short = cmd.length > 60 ? cmd.substring(0, 57) + "..." : cmd;
    return { category: "context", path: `bash: ${short}` };
  }

  return null;
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
  onItemClick,
  onItemRemove,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
  emptyText: string;
  onItemClick?: (path: string) => void;
  onItemRemove?: (path: string) => void;
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
                <div
                  key={path}
                  className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs hover:bg-muted/70 transition-colors text-left group"
                >
                  <button
                    type="button"
                    onClick={() => onItemClick ? onItemClick(path) : openFile(path)}
                    className="flex flex-1 items-center gap-2 min-w-0"
                    title={path}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate group-hover:text-foreground">{fileDisplayName(path)}</span>
                  </button>
                  {onItemRemove && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onItemRemove(path); }}
                      className="shrink-0 h-4 w-4 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskMetricsCard({ metrics }: {
  metrics: {
    cost?: number;
    humanHours?: number;
    complexity?: string;
    multiplier?: number;
    dollarsSaved?: number;
    taskType?: string;
    language?: string;
    ttftMs?: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const hasData = metrics.cost !== undefined || metrics.multiplier !== undefined;
  if (!hasData) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold hover:bg-muted/30 transition-colors rounded-t-xl"
      >
        <span className="flex-1 text-left text-xs">Task Metrics</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1">
          {metrics.cost !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Agent cost</span>
              <span className="font-mono">${metrics.cost.toFixed(4)}</span>
            </div>
          )}
          {metrics.humanHours !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Human est.</span>
              <span className="font-mono">~{metrics.humanHours}h {metrics.complexity ? `(${metrics.complexity})` : ""}</span>
            </div>
          )}
          {metrics.multiplier !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">ROI</span>
              <span className="font-mono font-semibold text-green-600 dark:text-green-400">{metrics.multiplier.toFixed(1)}× faster</span>
            </div>
          )}
          {metrics.dollarsSaved !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">$ saved</span>
              <span className="font-mono">${metrics.dollarsSaved.toFixed(0)}</span>
            </div>
          )}
          {metrics.taskType && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Task type</span>
              <span className="font-mono">{metrics.taskType}{metrics.language ? ` / ${metrics.language}` : ""}</span>
            </div>
          )}
          {metrics.ttftMs !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">TTFT</span>
              <span className="font-mono">{(metrics.ttftMs / 1000).toFixed(1)}s</span>
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
  onContextClick,
  onArtifactClick,
  onContextRemove,
  onArtifactRemove,
  previewUrl,
  onPreviewClick,
  taskMetrics,
}: {
  contextFiles: string[];
  artifactFiles: string[];
  folder: string | null;
  open: boolean;
  onToggle: () => void;
  onContextClick?: (path: string) => void;
  onArtifactClick?: (path: string) => void;
  onContextRemove?: (path: string) => void;
  onArtifactRemove?: (path: string) => void;
  previewUrl?: string | null;
  onPreviewClick?: () => void;
  taskMetrics?: {
    cost?: number;
    humanHours?: number;
    complexity?: string;
    multiplier?: number;
    dollarsSaved?: number;
    taskType?: string;
    language?: string;
    ttftMs?: number;
  };
}) {
  return (
    <div className={`flex flex-col h-full overflow-hidden shrink-0 transition-all duration-200 ${open ? "w-[300px]" : "w-10"}`}>
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
        <ScrollArea className="flex-1 min-h-0 px-3 pb-3">
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
              onItemClick={onContextClick}
              onItemRemove={onContextRemove}
            />

            <SidebarCard
              label="Artifacts"
              icon={FilePen}
              items={artifactFiles}
              emptyText="Files created or edited will appear here."
              onItemClick={onArtifactClick}
              onItemRemove={onArtifactRemove}
            />

            {/* Task Metrics panel */}
            {taskMetrics && <TaskMetricsCard metrics={taskMetrics} />}

            {/* Dev server preview chip */}
            {previewUrl && onPreviewClick && (
              <div className="rounded-xl border border-primary/30 bg-primary/5">
                <button
                  type="button"
                  onClick={onPreviewClick}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors rounded-xl"
                >
                  <Globe className="h-4 w-4" />
                  <span className="flex-1 text-left">Preview</span>
                  <span className="text-xs font-normal text-primary/70 truncate max-w-[140px]">
                    {previewUrl.replace(/^https?:\/\//, "")}
                  </span>
                </button>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export function CoworkSurface() {
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [cmdSuggestions, setCmdSuggestions] = useState<CommandSuggestion[]>([]);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(0);
  const { fileSuggestions, fetchAtSuggestions, clearAtSuggestions, resolveFileAsAttachment } =
    useAtSuggestions();
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const clearCanvas = useCanvasStore((s) => s.clearCanvas);
  const goBackCanvas = useCanvasStore((s) => s.goBack);
  const goForwardCanvas = useCanvasStore((s) => s.goForward);
  const setCanvasOpen = useCanvasStore((s) => s.setOpen);
  const canvasDoc = useCanvasStore((s) => s.canvasDoc);
  const canvasHistoryIndex = useCanvasStore((s) => s.historyIndex);
  const canvasHistoryLength = useCanvasStore((s) => s.history.length);
  const canvasOpen = useCanvasStore((s) => !!s.openSurfaces['cowork']);
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
  const storeFolder = useCoworkStore((s) => chatId ? s.folderByChat[chatId] ?? null : null);
  const folder = storeFolder || pendingFolder;
  const contextFiles = useCoworkStore((s) => (chatId ? s.contextFiles[chatId] : undefined) ?? EMPTY_FILES);
  const artifactFiles = useCoworkStore((s) => (chatId ? s.artifactFiles[chatId] : undefined) ?? EMPTY_FILES);
  const setModel = useCoworkStore((s) => s.setModel);
  const setFolder = useCoworkStore((s) => s.setFolder);
  const addMessage = useCoworkStore((s) => s.addMessage);
  const appendToLastAssistant = useCoworkStore((s) => s.appendToLastAssistant);
  const addToolCall = useCoworkStore((s) => s.addToolCall);
  const updateToolResult = useCoworkStore((s) => s.updateToolResult);
  const completeRunningTools = useCoworkStore((s) => s.completeRunningTools);
  const updateMessage = useCoworkStore((s) => s.updateMessage);
  const addContextFile = useCoworkStore((s) => s.addContextFile);
  const addArtifactFile = useCoworkStore((s) => s.addArtifactFile);
  const removeContextFile = useCoworkStore((s) => s.removeContextFile);
  const removeArtifactFile = useCoworkStore((s) => s.removeArtifactFile);
  const planContent = useCoworkStore((s) => (chatId ? s.planContent[chatId] : undefined));
  const planOpen = useCoworkStore((s) => s.planOpen);
  const setPlanContent = useCoworkStore((s) => s.setPlanContent);
  const setPlanOpen = useCoworkStore((s) => s.setPlanOpen);
  const sessionControls = useCoworkStore(
    (s) => (chatId ? s.sessionControls[chatId] : undefined) ?? DEFAULT_SESSION_CONTROLS
  );
  const setSessionControls = useCoworkStore((s) => s.setSessionControls);
  const startStreaming = useCoworkStore((s) => s.startStreaming);
  const stopStreaming = useCoworkStore((s) => s.stopStreaming);
  const setCurrentChat = useCoworkStore((s) => s.setCurrentChat);
  const setIsStreaming = useCoworkStore((s) => s.setIsStreaming);
  const setStreamError = useCoworkStore((s) => s.setStreamError);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const updateConversationMetrics = useConversationStore((s) => s.updateConversationMetrics);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const activeConvId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const personalPreferences = useSettingsStore((s) => s.personalPreferences);
  const displayName = useSettingsStore((s) => s.displayName);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);
  const blockDangerousCommands = useSettingsStore((s) => s.blockDangerousCommands);
  const blockNetworkCommands = useSettingsStore((s) => s.blockNetworkCommands);
  const restrictToProjectFolder = useSettingsStore((s) => s.restrictToProjectFolder);
  const disableBashTool = useSettingsStore((s) => s.disableBashTool);
  const devHourlyRate = useSettingsStore((s) => s.devHourlyRate);
  const { projectInstructions, projectKnowledge, projectId: currentProjectId, crossSurfaceContext, projectFolder } = useProjectContext(chatId, "cowork");
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const scratchDir = useScratchDir(chatId);
  // Auto-project creation disabled — users create projects manually
  const { showNotification } = useElectron();
  const showReminder = useReminderStore((s) => s.showReminder);

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

  useEffect(() => {
    if (!activeConvId) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    if (conv?.surface === "cowork") setCurrentChat(activeConvId);
  }, [activeConvId, conversations, setCurrentChat]);

  // Episodic memory: summarize previous conversation when switching
  const prevChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevChatIdRef.current;
    prevChatIdRef.current = chatId || null;
    if (prevId && prevId !== chatId) {
      const prevMessages = useCoworkStore.getState().messages[prevId];
      if (prevMessages && prevMessages.length > 0) {
        summarizeConversation(prevId, prevMessages);
      }
    }
  }, [chatId]);

  const { sendMessage, abort } = useSSEStream({
    chatId,
    setIsStreaming,
    setStreamError,
    onUsage(usage) {
      const id = useCoworkStore.getState().currentChatId;
      if (!id) return;
      // Store token usage
      updateConversationMetrics(id, {
        tokenUsage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cost: usage.cost,
          model: usage.model,
          durationMs: usage.durationMs,
          toolCallCount: usage.toolCallCount,
          ttftMs: usage.ttftMs,
        },
      });
      // Trigger effort estimation in background
      const allMsgs = useCoworkStore.getState().messages[id] ?? [];
      const toolCallCounts: Record<string, number> = {};
      allMsgs.forEach((m) => m.toolCalls?.forEach((tc) => {
        toolCallCounts[tc.name] = (toolCallCounts[tc.name] || 0) + 1;
      }));
      const toolCallsArr = Object.entries(toolCallCounts).map(([name, count]) => ({ name, count }));
      const artifactCount = (useCoworkStore.getState().artifactFiles[id] ?? []).length;
      fetch('/api/telemetry/estimate-effort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolCalls: toolCallsArr,
          artifactCount,
          messageCount: allMsgs.length,
          durationMs: usage.durationMs,
          model: usage.model,
        }),
      }).then((r) => r.json()).then(({ estimate }) => {
        if (!estimate) return;
        const humanHours = estimate.estimatedHours ?? 0;
        const agentCostDollars = usage.cost;
        const agentDurationMs = usage.durationMs;
        const humanCost = humanHours * devHourlyRate;
        const agentHours = agentDurationMs / 3_600_000;
        const multiplier = Math.round((humanHours / Math.max(agentHours, 0.001)) * 10) / 10;
        const dollarsSaved = Math.round((humanCost - agentCostDollars) * 100) / 100;
        updateConversationMetrics(id, {
          effortEstimate: {
            hours: humanHours,
            complexity: estimate.complexity,
            reasoning: estimate.reasoning,
            taskType: estimate.taskType,
            domain: estimate.domain,
            language: estimate.language,
          },
          roi: { multiplier, dollarsSaved },
        });

        // Send conversation_completed analytics event
        const conv = useConversationStore.getState().conversations.find((c) => c.id === id);
        const now = new Date();
        sendConversationCompletedEvent({
          surface: conv?.surface ?? 'cowork',
          model: usage.model,
          toolProfile: conv?.sessionStats?.toolProfile,
          hasProject: !!conv?.projectId,
          connectors: conv?.sessionStats?.connectors ?? [],
          connectorCount: (conv?.sessionStats?.connectors ?? []).length,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: agentCostDollars,
          durationMs: agentDurationMs,
          ttftMs: usage.ttftMs,
          toolCallCount: usage.toolCallCount,
          artifactCount,
          messageCount: allMsgs.length,
          clarificationCount: conv?.sessionStats?.clarificationCount ?? 0,
          aborted: conv?.sessionStats?.aborted ?? false,
          thinkingUsed: conv?.sessionStats?.thinkingUsed ?? false,
          estimatedHumanHours: humanHours,
          taskType: estimate.taskType,
          domain: estimate.domain,
          language: estimate.language,
          complexity: estimate.complexity,
          effortReasoning: estimate.reasoning,
          roiMultiplier: multiplier,
          dollarsSaved,
          hourOfDay: now.getHours(),
          dayOfWeek: now.getDay(),
        });
      }).catch(() => {});
    },
    onChunk(event) {
      switch (event.type) {
        case "turn_start":
          // New assistant turn — previous turn's tools have all completed
          completeRunningTools(chatId);
          break;
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
          // Detect QUARRY_CRON pattern in Bash commands — model echoes this to schedule reminders
          if (toolName === "Bash") {
            const cmd = typeof toolInput.command === "string" ? toolInput.command : "";
            const cronIdx = cmd.indexOf("QUARRY_CRON:");
            if (cronIdx !== -1) {
              const rest = cmd.slice(cronIdx + "QUARRY_CRON:".length).replace(/['"\\]/g, "");
              const sep = rest.indexOf(":");
              if (sep !== -1) {
                const expression = rest.slice(0, sep).trim();
                const cronPrompt = rest.slice(sep + 1).trim().split("\n")[0];
                if (expression && cronPrompt) {
                  const existing = useCronStore.getState().jobs;
                  if (!existing.some((j) => j.expression === expression && j.prompt === cronPrompt)) {
                    useCronStore.getState().addJob({ expression, prompt: cronPrompt, surfaceId: "cowork", enabled: true });
                    console.log("[Cowork] Cron job scheduled from Bash command:", expression, cronPrompt);
                  }
                }
              }
            }
          }
          // Categorize into sidebar panels
          const categorized = categorizeToolCall(toolName, toolInput);
          if (categorized && chatId) {
            if (categorized.category === "context") {
              // Don't add to Context if this path is already in Artifacts
              const currentArtifacts = useCoworkStore.getState().artifactFiles[chatId] ?? [];
              if (!currentArtifacts.includes(categorized.path)) {
                addContextFile(chatId, categorized.path);
              }
            } else {
              addArtifactFile(chatId, categorized.path);
              // Also register as project artifact
              if (currentProjectId) {
                const fileName = categorized.path.split("/").pop() || categorized.path;
                useProjectStore.getState().addArtifact(currentProjectId, {
                  id: crypto.randomUUID(),
                  name: fileName,
                  path: categorized.path,
                  type: "file",
                  surface: "cowork",
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
          const id = (event.tool_use_id as string) || (event.id as string) || "";
          const result =
            typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
          updateToolResult(chatId, id, result, event.is_error as boolean | undefined);
          // Detect dev server URLs in Bash output
          if (result && !event.is_error) {
            const detected = detectServerUrl(result);
            if (detected) setPreviewUrl(detected.url);
          }
          // Detect binary files mentioned in Bash output (e.g. python-pptx writing a .pptx)
          if (result && !event.is_error && chatId) {
            const allMsgs = useCoworkStore.getState().messages[chatId];
            const lastMsg = allMsgs?.at(-1);
            const matchingTc = lastMsg?.toolCalls?.find((tc) => tc.id === id);
            // Detect QUARRY_CRON in Bash output (fallback: model computed the expression via a script)
            if (matchingTc?.name === "Bash") {
              const cronIdx = result.indexOf("QUARRY_CRON:");
              if (cronIdx !== -1) {
                const rest = result.slice(cronIdx + "QUARRY_CRON:".length).replace(/['"\\]/g, "");
                const sep = rest.indexOf(":");
                if (sep !== -1) {
                  const expression = rest.slice(0, sep).trim();
                  const cronPrompt = rest.slice(sep + 1).trim().split("\n")[0];
                  if (expression && cronPrompt) {
                    const existing = useCronStore.getState().jobs;
                    if (!existing.some((j) => j.expression === expression && j.prompt === cronPrompt)) {
                      useCronStore.getState().addJob({ expression, prompt: cronPrompt, surfaceId: "cowork", enabled: true });
                      console.log("[Cowork] Cron job scheduled from Bash output:", expression, cronPrompt);
                    }
                  }
                }
              }
            }
            if (matchingTc?.name === "Bash") {
              const coworkFolder = useCoworkStore.getState().folder;
              BASH_ARTIFACT_EXT.lastIndex = 0;
              let m;
              while ((m = BASH_ARTIFACT_EXT.exec(result)) !== null) {
                let filePath = m[1];
                // Skip false positives: bare extensions, /dev/null, numeric-heavy fragments
                if (filePath.length < 3 || filePath.startsWith(".") || filePath === "/dev/null") continue;
                if (/^[0-9.:]+$/.test(filePath.replace(/\.(?:pdf|csv|png|jpe?g)$/i, ""))) continue;
                if (!filePath.startsWith("/") && coworkFolder) {
                  const cwdBasename = coworkFolder.split("/").pop() || "";
                  if (cwdBasename && filePath.startsWith(`${cwdBasename}/`)) {
                    filePath = filePath.slice(cwdBasename.length + 1);
                  }
                  filePath = `${coworkFolder}/${filePath}`;
                }
                addArtifactFile(chatId, filePath);
              }
            }
          }
          break;
        }
        case "input_request": {
          // Agent is asking the user a question — add a question message
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
        }
        case "canvas": {
          // Agent pushed a canvas document — open the canvas panel
          try {
            const doc = event.doc as A2UIDocument;
            if (doc && doc.components) {
              pushCanvas(doc);
              setCanvasOpen('cowork', true);
            }
          } catch (e) {
            console.error('[Cowork] Canvas parse error:', e);
          }
          break;
        }
        case "cron_create": {
          // Agent created a cron job — add to cron-store so UI reflects it
          try {
            const input = event.input as Record<string, unknown>;
            const expression = (input.cron || input.expression) as string;
            const prompt = (input.prompt || input.message || input.task) as string;
            const surfaceId = (input.surfaceId || input.surface || 'cowork') as string;
            if (expression && prompt) {
              useCronStore.getState().addJob({ expression, prompt, surfaceId, enabled: true });
              console.log('[Cowork] Cron job added:', expression, prompt);
            }
          } catch (e) {
            console.error('[Cowork] CronCreate parse error:', e);
          }
          break;
        }
        case "document_extracting": {
          // Show extraction status in console — could add UI indicator
          console.log('[Cowork] Extracting document:', event.name);
          break;
        }
        case "document_extracted": {
          // Add extracted document to context sidebar
          const extractedPath = event.extractedPath as string | undefined;
          if (extractedPath && chatId) {
            addContextFile(chatId, extractedPath);
          }
          console.log('[Cowork] Document extracted:', event.name, 'path:', extractedPath, 'length:', event.textLength);
          break;
        }
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
      completeRunningTools(chatId);
      stopStreaming(chatId);
      const allMsgs = useCoworkStore.getState().messages[chatId];
      const lastMsg = allMsgs?.at(-1);
      // Inline plan detection: check last assistant message for plan heading
      if (lastMsg?.role === "assistant" && lastMsg.content && /^#{1,2}\s+plan\b/im.test(lastMsg.content.slice(0, 500))) {
        setPlanContent(chatId, lastMsg.content);
      }
      // Detect binary artifacts mentioned in Bash tool OUTPUT (not assistant text).
      // Only confirmed tool results are scanned — assistant text mentions like
      // "I'll create report.pdf" are ignored to avoid phantom artifacts.
      // (Bash tool_result detection already happens in the tool_result SSE handler above.
      //  This block verifies existing artifacts still exist on disk and removes phantoms.)
      if (chatId) {
        const currentArtifacts = useCoworkStore.getState().artifactFiles[chatId] ?? [];
        if (currentArtifacts.length > 0 && window.electronAPI?.fileExists) {
          for (const artifactPath of currentArtifacts) {
            // Skip non-absolute paths and bash: labels
            if (!artifactPath.startsWith("/")) continue;
            window.electronAPI.fileExists(artifactPath).then((exists: boolean) => {
              if (!exists) {
                console.log("[Cowork] Removing phantom artifact (file not found):", artifactPath);
                removeArtifactFile(chatId, artifactPath);
              }
            }).catch(() => {});
          }
        }
      }
      // Auto-continuation: if the agent ended mid-task (many tool calls + last message
      // suggests more work to do), automatically send a "continue" prompt
      if (chatId && allMsgs && allMsgs.length > 2) {
        const totalToolCalls = allMsgs.reduce(
          (sum, m) => sum + (m.toolCalls?.length ?? 0), 0
        );
        const lastContent = lastMsg?.content?.trim() ?? "";
        const looksUnfinished = totalToolCalls >= 10 && /\b(let me|i'll|i will|now (let|i)|going to|next[,.]?\s*(i|let))\b/i.test(lastContent.slice(-300));
        if (looksUnfinished) {
          console.log("[Cowork] Auto-continuing — agent appears to have run out of turns mid-task");
          // Small delay so the UI shows the partial response before we continue
          setTimeout(() => {
            const continuePrompt = "Continue — complete the file generation. Do not re-explain what you've done. Execute the remaining tool calls to produce the deliverable.";
            addMessage(chatId, { id: crypto.randomUUID(), role: "user", content: continuePrompt, timestamp: Date.now(), isAutoContinue: true } as Message);
            addMessage(chatId, { id: crypto.randomUUID(), role: "assistant", content: "", timestamp: Date.now(), isLoading: true, isStreaming: true });
            startStreaming(chatId);
            const currentControls = useCoworkStore.getState().sessionControls[chatId] ?? DEFAULT_SESSION_CONTROLS;
            const priorMsgs = useCoworkStore.getState().messages[chatId] || [];
            const hist = stripMessagesForHistory(priorMsgs.slice(0, -2));
            void sendMessage(continuePrompt, chatId, "cowork", model, {
              personalPreferences: personalPreferences || undefined,
              displayName: displayName || undefined,
              cwd: folder || projectFolder || scratchDir || undefined,
              history: hist.length > 0 ? hist : undefined,
              sessionControls: currentControls,
            });
          }, 1500);
          return; // skip "task complete" notification
        }
      }
      if (!document.hasFocus()) {
        showNotification("Task complete", "Claude has finished working on your request.");
      }
    },
    onError: (error) => {
      stopStreaming(chatId);
      appendToLastAssistant(chatId, `\n\n**Error:** ${error.message}`);
    },
  });

  const handleQuestionAnswered = useCallback(
    (toolUseId: string) => {
      if (chatId) {
        updateMessage(chatId, toolUseId, { questionAnswered: true });
      }
    },
    [chatId, updateMessage]
  );

  // Ref to break circular dependency: handleSubmit uses resetIdleTimer, but
  // useHeartbeat (which provides resetIdleTimer) is called after handleSubmit.
  const resetIdleTimerRef = useRef<(() => void) | null>(null);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      resetIdleTimerRef.current?.();
      const trimmed = text.trim();

      // ── Slash command interception ───────────────────────────────────────
      const parsed = parseSlashCommand(trimmed);
      if (parsed) {
        const result = applySlashCommand(parsed, sessionControls);
        if (result) {
          let id = chatId;
          if (!id) {
            id = crypto.randomUUID();
            addConversation({ id, title: trimmed.substring(0, 50), surface: 'cowork', lastMessage: trimmed, createdAt: Date.now(), updatedAt: Date.now() });
            setActiveConversation(id);
            setCurrentChat(id);
          }
          setSessionControls(id, result.controls);
          addMessage(id, { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: Date.now() });
          addMessage(id, { id: crypto.randomUUID(), role: 'assistant', content: result.message, timestamp: Date.now() });
          setInputValue('');
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
          surface: "cowork",
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
      // Grab prior messages for history fallback (exclude just-added user + assistant placeholder)
      const priorMessages = useCoworkStore.getState().messages[id] || [];
      const history = stripMessagesForHistory(priorMessages.slice(0, -2));

      // Register conversation with project
      if (currentProjectId) {
        useProjectStore.getState().addConversationToProject(currentProjectId, "cowork", id);
      }

      // Retrieve relevant memories
      const relevantMemories = useMemoryStore.getState().getMemoriesForContext({
        projectId: currentProjectId,
        query: trimmed,
      });
      const memoriesStr = formatMemoriesForPrompt(relevantMemories);
      relevantMemories.forEach((m) => useMemoryStore.getState().touchMemory(m.id));

      const currentControls = useCoworkStore.getState().sessionControls[id] ?? DEFAULT_SESSION_CONTROLS;
      await sendMessage(trimmed, id, "cowork", model, {
        personalPreferences: personalPreferences || undefined,
        displayName: displayName || undefined,
        projectInstructions: projectInstructions || undefined,
        projectKnowledge: projectKnowledge || undefined,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        apiKey: nibGatewayApiKey || undefined,
        cwd: folder || projectFolder || scratchDir || undefined,
        history: history.length > 0 ? history : undefined,
        memories: memoriesStr || undefined,
        crossSurfaceContext: crossSurfaceContext || undefined,
        sessionControls: currentControls,
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
      folder,
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

  const handleVoiceTranscript = useCallback(
    (text: string) => setInputValue((prev) => (prev ? `${prev} ${text}` : text)),
    []
  );

  // Fire a background agent run on the cowork surface (used by heartbeat + cron)
  const fireBackgroundRun = useCallback(
    (prompt: string) => {
      const bgId = crypto.randomUUID();
      addConversation({
        id: bgId,
        title: `[auto] ${prompt.slice(0, 40)}`,
        surface: 'cowork',
        lastMessage: prompt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isBackground: true,
      });
      addMessage(bgId, { id: crypto.randomUUID(), role: 'user', content: prompt, timestamp: Date.now() });
      addMessage(bgId, { id: crypto.randomUUID(), role: 'assistant', content: '', timestamp: Date.now(), isLoading: true, isStreaming: true });
      startStreaming(bgId);
      void sendMessage(prompt, bgId, 'cowork', model, {
        personalPreferences: personalPreferences || undefined,
        displayName: displayName || undefined,
        cwd: folder || projectFolder || scratchDir || undefined,
      });
    },
    [addConversation, addMessage, startStreaming, sendMessage, model, personalPreferences, displayName, folder, projectFolder, scratchDir]
  );

  // Silent heartbeat runner — fetches /api/chat/chat with a throwaway ID, stores result in heartbeat-store
  const runSilentHeartbeat = useCallback(
    async (prompt: string) => {
      try {
        const hbId = `hb-${crypto.randomUUID()}`;
        const resp = await fetch('/api/chat/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: prompt, chatId: hbId, surface: 'chat', model }),
        });
        if (!resp.ok || !resp.body) return;
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'text' && typeof event.content === 'string') {
                text += event.content;
              }
            } catch {
              // ignore parse errors
            }
          }
        }
        const summary = text.trim();
        if (summary) {
          useHeartbeatStore.getState().addEntry({
            summary,
            type: 'heartbeat',
            unread: true,
            timestamp: Date.now(),
          });
        }
      } catch {
        // silent — no UI impact
      }
    },
    [model]
  );

  const { resetIdleTimer } = useHeartbeat(runSilentHeartbeat);
  resetIdleTimerRef.current = resetIdleTimer;
  useCron((job) => {
    playDing();
    showReminder(job.id, job.prompt);
    fireBackgroundRun(job.prompt);
  });

  // Compute merged suggestions: slash takes priority over @
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
      // @ file: remove @partial from input, resolve file, add as attachment
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

    // Slash suggestions (only when text starts with /)
    const slashSuggs = getSlashSuggestions(val);
    setCmdSuggestions(
      slashSuggs.map((cmd) => ({
        type: 'slash' as const,
        value: cmd.name,
        label: cmd.name,
        description: cmd.args,
        meta: cmd.description,
      }))
    );

    // @ file suggestions
    const atQ = getAtQuery(val);
    if (atQ !== null) {
      const cwd = folder || projectFolder || scratchDir || '';
      if (cwd) fetchAtSuggestions(atQ, cwd);
      else clearAtSuggestions();
    } else {
      clearAtSuggestions();
    }

    setSelectedSuggestionIdx(0);
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
            <CommandPicker
              suggestions={activeSuggestions}
              selectedIndex={selectedSuggestionIdx}
              onSelect={handleSelectSuggestion}
              onSelectedIndexChange={setSelectedSuggestionIdx}
            />
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
                    onWebSearchToggle={undefined as never}
                    webSearchEnabled={false}
                    hideWebSearch
                    currentProjectId={currentProjectId}
                    onAddToProject={(pid) => assignToProject(chatId, pid)}
                    onNewProject={() => setSidebarMode("projects")}
                    projects={allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
                  />
                  <VoiceButton onTranscript={handleVoiceTranscript} />
                  <FolderPicker folder={folder} onFolderChange={handleFolderChange} scratchActive={!folder && !!scratchDir} />
                  <EditorPicker folder={folder} />
                  {planContent && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setPlanOpen(true)}
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                      Plan
                    </Button>
                  )}
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
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Messages column */}
          <div className="flex flex-1 flex-col min-w-0">
            {/* Continue in Surface handoff (when project is active) */}
            {currentProjectId && !isStreaming && messages.length > 0 && (
              <div className="flex items-center gap-2 px-6 py-1.5 border-b border-border/50">
                <span className="text-xs text-muted-foreground">Continue in:</span>
                <ContinueInSurface
                  currentSurface="cowork"
                  projectId={currentProjectId}
                  conversationId={chatId}
                />
              </div>
            )}
            <MessageList messages={messages} onQuestionAnswered={handleQuestionAnswered} onArtifactClick={(v) => { if (typeof v === 'string') setPreviewPath(v); }} onPreviewUrl={(url) => { setPreviewUrl(url); setPreviewOpen(true); }} conversationId={chatId} />

            {/* Bottom input card */}
            <div className="px-6 pb-4 pt-2">
              <div className="max-w-3xl mx-auto">
                <CommandPicker
                  suggestions={activeSuggestions}
                  selectedIndex={selectedSuggestionIdx}
                  onSelect={handleSelectSuggestion}
                  onSelectedIndexChange={setSelectedSuggestionIdx}
                />
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
                        currentProjectId={currentProjectId}
                        onAddToProject={(pid) => assignToProject(chatId, pid)}
                        onNewProject={() => setSidebarMode("projects")}
                        projects={allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
                      />
                      <VoiceButton onTranscript={handleVoiceTranscript} />
                      <FolderPicker folder={folder} onFolderChange={handleFolderChange} scratchActive={!folder && !!scratchDir} />
                      <EditorPicker folder={folder} />
                      {planContent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setPlanOpen(true)}
                        >
                          <ListChecks className="h-3.5 w-3.5" />
                          Plan
                        </Button>
                      )}
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
            onContextClick={(path) => {
              // URLs open in browser; file paths open in the preview sheet
              if (path.startsWith("http")) {
                window.open(path, "_blank");
              } else {
                // Resolve relative paths against the working folder
                const resolved = folder && !path.startsWith("/") ? `${folder}/${path}` : path;
                setPreviewPath(resolved);
              }
            }}
            onArtifactClick={(path) => {
              // Resolve relative paths against the working folder
              if (folder && !path.startsWith("/")) {
                setPreviewPath(`${folder}/${path}`);
              } else {
                setPreviewPath(path);
              }
            }}
            onContextRemove={(path) => {
              if (chatId) removeContextFile(chatId, path);
            }}
            onArtifactRemove={(path) => {
              if (!chatId) return;
              const resolved = folder && !path.startsWith("/") ? `${folder}/${path}` : path;
              if (folder) {
                // Delete the file if it's inside the working directory
                fetch("/api/files/delete", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ path: resolved, cwd: folder }),
                }).catch((err) => console.error("Failed to delete artifact:", err));
              }
              removeArtifactFile(chatId, path);
            }}
            previewUrl={previewUrl}
            onPreviewClick={() => setPreviewOpen(true)}
            taskMetrics={(() => {
              const conv = conversations.find((c) => c.id === chatId);
              if (!conv) return undefined;
              return {
                cost: conv.tokenUsage?.cost,
                ttftMs: conv.tokenUsage?.ttftMs,
                humanHours: conv.effortEstimate?.hours,
                complexity: conv.effortEstimate?.complexity,
                taskType: conv.effortEstimate?.taskType,
                language: conv.effortEstimate?.language,
                multiplier: conv.roi?.multiplier,
                dollarsSaved: conv.roi?.dollarsSaved,
              };
            })()}
          />

          {/* Dev server preview panel */}
          {previewUrl && (
            <PreviewPanel
              url={previewUrl}
              open={previewOpen}
              onClose={() => setPreviewOpen(false)}
            />
          )}

          {/* Canvas panel */}
          <CanvasPanel
            open={canvasOpen}
            doc={canvasDoc}
            onClose={() => setCanvasOpen('cowork', false)}
            onBack={goBackCanvas}
            onForward={goForwardCanvas}
            onClear={clearCanvas}
            canGoBack={canvasHistoryIndex > 0}
            canGoForward={canvasHistoryIndex < canvasHistoryLength - 1}
          />
        </div>
      )}

      {/* Artifact file preview drawer */}
      <FilePreviewSheet
        path={previewPath}
        open={!!previewPath}
        onClose={() => setPreviewPath(null)}
      />

      {/* Plan sheet */}
      <PlanSheet
        content={planContent}
        open={planOpen}
        onClose={() => setPlanOpen(false)}
      />
    </div>
  );
}
