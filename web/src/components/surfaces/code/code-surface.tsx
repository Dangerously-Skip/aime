"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FolderPicker } from "@/components/shared/folder-picker";
import { CloneFromGitHub } from "@/components/shared/clone-from-github";
import { useConnectorStore } from "@/stores/connector-store";
import { ToolCallCard } from "@/components/shared/tool-call-card";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import { StreamingCursor } from "@/components/shared/streaming-cursor";
import { QuestionCard } from "@/components/shared/question-card";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { useFileDrop } from "@/hooks/use-file-drop";
import { useCodeStore } from "@/stores/code-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSearchSettings } from '@/hooks/use-search-settings'
import { useDeckTheme } from '@/hooks/use-deck-theme'
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream, stripMessagesForHistory } from "@/hooks/use-sse-stream";
import { handleAgnosticChunk } from "@/lib/sse/agnostic-chunks";
import { handleCoreChunk } from "@/lib/sse/core-chunks";
import { handleBrowserToolChunk } from "@/lib/sse/browser-tool-chunk";
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
import { Button } from "@/components/ui/button";
import { ConnectionSelector } from "@/components/shared/connection-selector";
import { Folder, Github } from "lucide-react";
import { PreviewPanel } from "@/components/shared/preview-panel";
import { PlanSheet } from "@/components/shared/plan-sheet";
import { ThinkingSection } from "@/components/shared/thinking-section";
import { EditorPicker } from "@/components/shared/editor-picker";
import { detectServerUrl, isWebAsset, findHtmlEntryPoint } from "@/lib/artifacts/server-detector";
import { previewUrlFor } from "@/lib/preview/client";
import { useGoalAutoOpen } from "@/components/harness/use-goal-autoopen";
import {
  GoalModeToggle, GoalModeBar, goalSettingsFrom,
  DEFAULT_BUDGET_USD, DEFAULT_SESSION_CAP,
} from "@/components/harness/goal-mode";
import { useStartGoal } from "@/components/harness/use-start-goal";
import { GoalRunStatus } from "@/components/harness/goal-run-status";
import { GoalQuestion } from "@/components/harness/goal-question";
import { useGoalTranscript } from "@/components/harness/use-goal-transcript";
import { ConsoleLogBuffer, type WebviewRef } from "@/lib/browser-tools";
import type { Message } from "@/stores/chat-store";
import { ListChecks } from "lucide-react";
import { parseSlashCommand, applySlashCommand, DEFAULT_SESSION_CONTROLS } from "@/lib/slash-commands";
import { WorkspaceLayout } from "./workspace/workspace-layout";
import { tagSecurityWarning } from "./security-warning";
import { CodeInput, type CodeInputProps } from "./code-input";
import { isUntitledConversation } from "./composer-keys";
import { useProviderStore } from "@/stores/provider-store";
import { resolveSendRoute } from "@/lib/models/client-options";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useTurnWiring } from "@/hooks/use-turn-wiring";
import { useBuiltinAccess } from "@/hooks/use-builtin-access";
import { useScheduledPrompt } from "@/hooks/use-scheduled-prompt";
import { APP_NAME } from "@/config/branding";

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
  const deckTheme = useDeckTheme(chatId);
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
  /*
   * The LOCAL path behind the current preview.
   *
   * Auto-refresh used to derive this by string-slicing a `file://` URL. Previews
   * are now served over http (see lib/preview/static-server.ts), so that slice
   * matches nothing and refresh silently stops — the preview looks live and is
   * stale. Track the path we opened instead of re-deriving it from the URL.
   */
  const previewPathRef = useRef<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  /*
   * Let the USER open the preview.
   *
   * `previewUrl` gates whether the panel mounts, and nothing user-initiated set
   * it: the panel appeared only when the agent wrote an HTML file or started a
   * dev server. Browser tools are offered to the agent only while this webview
   * is live, so the most capable agent in the app could drive a browser and
   * nobody could give it a page to start from — a capability wired but
   * unreachable, which is the failure this whole line of work exists to fix.
   *
   * about:blank rather than a home page: the address bar is right there, and
   * picking a destination on the user's behalf is a decision nobody asked for.
   */
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    /*
     * Two halves, two owners.
     *
     * The SURFACE owns the content gate (`previewUrl`, which decides whether
     * there is anything to render) and the webview's lifecycle. The LAYOUT owns
     * placement, because the panel is a dockview panel now and only dockview
     * knows where panels go. So this sets the URL and delegates to
     * `__ideOpenPreviewPanel`, which workspace-layout registers.
     *
     * `current ?? 'about:blank'` rather than an assignment: opening while the
     * agent's own preview is showing should focus it, not navigate away from
     * what it just built.
     */
    w.__ideOpenPreview = () => {
      setPreviewUrl((current) => current ?? 'about:blank');
      setPreviewOpen(true);
      (w.__ideOpenPreviewPanel as (() => void) | undefined)?.();
    };
    return () => { delete w.__ideOpenPreview; };
  }, []);
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
    const previewPath = previewPathRef.current;
    if (!previewUrl || !previewPath) return;
    const previewDir = previewPath.substring(0, previewPath.lastIndexOf("/"));
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
      previewPathRef.current = htmlPath;
      const { url } = await previewUrlFor(htmlPath);
      setPreviewUrl(url);
    }
    pendingWebAssets.current = [];
  }, [folder]);

  // Surfaces the goal panel when this conversation has a goal run.
  useGoalAutoOpen(chatId, folder);

  /*
   * Goal mode, same as Cowork.
   *
   * This surface benefits most: tests are a real gate here, so the verifier has
   * something concrete to run. It was left out of the first pass entirely.
   */
  const [goalMode, setGoalMode] = useState(false);
  const [goalBudget, setGoalBudget] = useState(String(DEFAULT_BUDGET_USD));
  const [goalCap, setGoalCap] = useState(String(DEFAULT_SESSION_CAP));
  const { start: startGoal, phase: goalPhase, error: goalStartError, setError: setGoalError } =
    useStartGoal("code", modelRoute ?? null);
  const goalBusy = goalPhase !== "idle";
  const [goalPending, setGoalPending] = useState<string | null>(null);
  const [goalNudge, setGoalNudge] = useState(0);
  // The run narrates itself into the transcript here too — the Goal panel is a
  // dockview tab that may not even be open.
  useGoalTranscript(chatId, folder, addMessage);


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
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const userScrolledUpRef = useRef(false);

  // Auto-scroll via ResizeObserver — fires on any content size change.
  // A callback ref, not a mount effect: the transcript lives in a dockview
  // panel that mounts after the surface does, so a `[]` effect found no node
  // and never observed anything.
  const contentRef = useCallback((content: HTMLDivElement | null) => {
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

      /*
       * THE SHARED RELAY, which Code was supposed to be using already.
       *
       * `lib/sse/browser-tool-chunk` exists because copying forty lines is how
       * two implementations of one idea drift apart — and Code kept its inline
       * copy anyway, so the shared module's own comment ("shared with Code
       * rather than copied") was aspirational.
       *
       * The drift was already real: the shared path grew tab handling and this
       * one never did, while `browserMcpToolNames()` mounts new_tab/switch_tab/
       * close_tab for EVERY surface with a webview. Code therefore offered three
       * tools whose only possible answer was "Unknown tool" — DR-21's retry loop,
       * reintroduced by the change that was meant to end it.
       *
       * Code has ONE preview view, so its tab callbacks say so actionably rather
       * than pretending: the shared module turns an absent `tabs` into "this
       * surface shows a single page, not tabs — use navigate".
       */
      if (
        handleBrowserToolChunk(event, {
          chatId,
          webview: previewWebviewRef.current,
          consoleBuffer: consoleBufferRef.current,
          addToolCall,
          updateToolResult,
          noWebviewMessage:
            'The preview panel is not open, so there is no page to act on. Write an HTML file or start a dev server first, or use WebFetch to read a URL.',
          surface: 'CodeSurface',
        })
      ) {
        return;
      }

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
          // Tag risky Bash commands — the same classifier as the server's gate.
          toolCallData.input = tagSecurityWarning(toolName, toolInput, useSettingsStore.getState());
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
            if (detected) { previewPathRef.current = null; setPreviewUrl(detected.url); }
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
        // Served over http, not file:// — a null origin breaks embeds, ES
        // modules and fetch. See lib/preview/static-server.ts.
        previewPathRef.current = lastHtml;
        void previewUrlFor(lastHtml).then(({ url }) => setPreviewUrl(url));
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
        showNotification("Task complete", `${APP_NAME} has finished working on your request.`);
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
        // "New Chat", not the command: `/think high` is not a name, and the
        // first real message titles an untitled conversation.
        addConversation({ id, title: 'New Chat', surface: 'code', lastMessage: text, createdAt: Date.now(), updatedAt: Date.now() });
        setActiveConversation(id);
        setCurrentChat(id);
        // The folder picked before any conversation existed belongs to this one.
        if (pendingFolder) {
          setFolder(id, pendingFolder);
          setPendingFolder(null);
        }
        return id;
      })();
      setSessionControls(effectiveId, result.controls);
      addMessage(effectiveId, { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now() });
      addMessage(effectiveId, { id: crypto.randomUUID(), role: 'assistant', content: result.message, timestamp: Date.now() });
      setInputValue('');
      return true;
    },
    [chatId, sessionControls, setSessionControls, addMessage, addConversation, setActiveConversation, setCurrentChat, pendingFolder, setFolder]
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const trimmed = text.trim();

      // Goal mode is a property of the send, not a second composer.
      if (goalMode) {
        const settings = goalSettingsFrom(goalBudget, goalCap);
        if (typeof settings === "string") return setGoalError(settings);
        if (!folder) return setGoalError("Pick a folder first — the plan and progress live there.");
        // A goal needs a conversation; the branch returns before the auto-create
        // below, so a brand new chat would post conversationId: "" and 400.
        if (!chatId) {
          setGoalError("Send a message first, or pick an existing chat — a goal needs a conversation to live in.");
          return;
        }
        setGoalPending(trimmed);
        const ok = await startGoal({
          conversationId: chatId,
          workingDir: folder,
          objective: trimmed,
          ...settings,
        });
        setGoalPending(null);
        if (ok) {
          setGoalNudge((n) => n + 1);
          setInputValue("");
          setGoalMode(false);
          if (chatId) {
            const existing = allConversations.find((c) => c.id === chatId);
            if (isUntitledConversation(existing?.title)) {
              updateConversation(chatId, {
                title: trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed,
              });
            }
          }
          // Best effort. The run lives on the server and is unaffected if the
          // panel cannot be placed; the inline status below the composer is the
          // feedback that must not depend on dockview.
          try {
            // `true` — the user just pressed send on a goal, so moving them to
            // the panel is what they asked for. The status poll passes nothing.
            const open = (window as unknown as Record<string, unknown>).__ideOpenGoal;
            if (typeof open === "function") (open as (focus?: boolean) => void)(true);
          } catch {
            /* the panel is a convenience, not the run */
          }
        }
        return;
      }

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
      // Title only a conversation that has none yet. This renamed it on EVERY
      // send, so a thread titled by its first request — or renamed by the user —
      // ended up named after whatever was typed last.
      const currentTitle = useConversationStore.getState().conversations.find((c) => c.id === id)?.title;
      updateConversation(id, {
        ...(isUntitledConversation(currentTitle) ? { title: trimmed.substring(0, 50) } : {}),
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
        /*
         * Only when the preview panel is actually open. The webview ref is null
         * when it is closed, and offering `navigate` with nothing to navigate is
         * DR-21's loop: the agent cannot discover that a step is impossible, so
         * it repeats it until the turn dies.
         */
        browserToolsAvailable: !!previewWebviewRef.current,
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
        deckTheme,
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

  /*
   * A due cron job runs HERE, through this surface's own submit — not through a
   * scheduler with a send path of its own, which would be a fourth place that
   * starts a turn. Before this, a job published to the bus, switched surface,
   * and nothing ran it.
   *
   * The busy guard is load-bearing here in a way it is not elsewhere: without
   * it, a job firing mid-turn called sendMessage, whose registry aborts the
   * previous stream as 'superseded' — tearing down the user's running turn
   * (mid-build, mid-refactor) silently, because 'superseded' deliberately
   * reports nothing. A long-running task and a standing order on overlapping
   * schedules is the normal case, not an edge case.
   */
  useScheduledPrompt('code', handleSubmit, () => useCodeStore.getState().isStreaming);

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

  /*
   * ONE set of composer props, used by both states.
   *
   * There were two hand-written <CodeInput> calls and they drifted: the active
   * one — the composer you use for every message after the first — was never
   * given `cwd` or `onSlashCommand`, so @-mentions and slash commands silently
   * stopped working once a conversation started, and it lost the goal question
   * and run status too. Only the layout-specific bits differ now.
   */
  const composerProps: Omit<CodeInputProps, "placeholder" | "rows" | "minHeight"> = {
    value: inputValue,
    onChange: setInputValue,
    onSubmit: handleSubmit,
    onAbort: abort,
    isStreaming,
    cwd: folder,
    onSlashCommand: handleSlashCommand,
    permissionMode,
    onPermissionModeChange: setPermissionMode,
    model: modelRoute?.id ?? "",
    onSelectModel: setModelRoute,
    attachments,
    onAttachmentAdd: handleAttachmentAdd,
    onAttachmentRemove: handleAttachmentRemove,
    currentProjectId,
    onAddToProject: (pid) => assignToProject(chatId, pid),
    onNewProject: () => setSidebarMode("projects"),
    projects: allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon })),
    onVoiceTranscript: handleVoiceTranscript,
    planButton,
    goalToggle: <GoalModeToggle on={goalMode} onChange={setGoalMode} disabled={goalBusy} />,
    goalQuestion: folder ? <GoalQuestion chatId={chatId} folder={folder} surfaceId="code" /> : null,
    goalStatus: folder ? (
      <GoalRunStatus
        chatId={chatId} folder={folder} surfaceId="code"
        nudge={goalNudge}
        starting={
          goalPending && goalPhase !== "idle"
            ? { objective: goalPending, phase: goalPhase }
            : null
        }
      />
    ) : null,
    goalBar: goalMode ? (
      <GoalModeBar
        budget={goalBudget} cap={goalCap}
        onBudget={setGoalBudget} onCap={setGoalCap}
        disabled={goalBusy} error={goalStartError}
      />
    ) : null,
  };

  return (
    <div className="relative flex h-full flex-col bg-background" {...dropZoneProps}>
      <DropOverlay visible={isDragging} />

      {!folder ? (
        /* ── Welcome: no folder yet, so there is no workspace to show ── */
        <div className="flex flex-1 flex-col items-center justify-center px-6 animate-in fade-in duration-300">
          <Mascot />
          <div className="w-full max-w-2xl">
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
          </div>
        </div>
      ) : (
        /*
         * ── Workspace: tree + editor + terminal + chat, as soon as a folder is
         * chosen. It used to wait for the first MESSAGE (`messages.length === 0`
         * showed a mascot instead), so the file tree, editor and terminal of the
         * folder you had just picked were hidden until you had asked the agent
         * for something — you could not look at the code before talking about it.
         */
        <WorkspaceLayout
          workspace={folder}
          chatId={chatId}
          /*
           * The preview is a DOCKVIEW PANEL now, not an overlay.
           *
           * It used to render here as a sibling of the dock — floating over the
           * chat panel with no tab, so it could not be docked, dragged or
           * placed like every other region. The content still belongs to the
           * surface, which owns the webview's lifecycle and hands its ref to
           * the agent; only the framing moved.
           */
          /*
             UNCONDITIONAL. It used to be `previewUrl ? <PreviewPanel/> : null`,
             which is the same defect as the last two rounds, one layer up: the
             panel's address bar is the only way for a user to SET a url, and it
             lived inside a component that only mounted once a url was already
             set. You needed a URL to reach the box that lets you type a URL, so
             the panel opened as an empty dark rectangle and stayed that way.

             The panel existing IS the user asking for it. What goes in it is
             `about:blank` until somebody — the agent or the user — says
             otherwise.
          */
          previewSlot={
            <PreviewPanel
              url={previewUrl ?? ''}
              open
              onClose={() => setPreviewOpen(false)}
              refreshKey={refreshKey}
              onWebviewReady={(ref) => { previewWebviewRef.current = ref as WebviewRef | null; }}
              onConsoleMessage={(level, message) => { consoleBufferRef.current.push(level, message); }}
            />
          }
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

                {/*
                  The "Preview about:blank" chip lived here — the overlay's
                  show/hide toggle, sitting inside the CHAT panel because that
                  is where the overlay was anchored. The panel has its own tab
                  now, so the chip was a second control for the same thing in
                  the wrong place.
                */}

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
                      {isEmpty ? (
                        <div
                          className="flex h-full flex-col items-center justify-center text-center text-muted-foreground animate-in fade-in duration-300"
                          data-testid="code-chat-empty"
                        >
                          <Mascot />
                          <p className="text-sm">What should we work on in this folder?</p>
                        </div>
                      ) : (
                        <div ref={contentRef} className="max-w-3xl mx-auto relative">
                          <TerminalOutput
                            messages={messages as TerminalMessage[]}
                            onQuestionAnswered={onQuestionAnswered}
                            onPreviewUrl={(url) => { setPreviewUrl(url); setPreviewOpen(true); }}
                            endRef={endRef}
                          />
                        </div>
                      )}
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
                          {...composerProps}
                          placeholder={isEmpty ? "Find a small todo in the codebase and do it" : "Describe a task..."}
                          rows={isEmpty ? 2 : 1}
                          minHeight={isEmpty ? "min-h-[72px]" : "min-h-[36px]"}
                        />
                        <BottomBar folder={folder} onFolderChange={handleFolderChange} />
                      </div>
                    </div>
                  </div>

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
