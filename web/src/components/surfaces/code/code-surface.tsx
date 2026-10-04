"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FolderPicker } from "@/components/shared/folder-picker";
import { CloneFromGitHub } from "@/components/shared/clone-from-github";
import { useConnectorStore } from "@/stores/connector-store";
import { MessageList } from "@/components/shared/message-list";
import { ModelSelector } from "@/components/shared/model-selector";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { Composer } from "@/components/shared/composer/composer";
import { addComposerAttachment } from "@/components/shared/composer/draft-store";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { useFileDrop } from "@/hooks/use-file-drop";
import { useCodeStore } from "@/stores/code-store";
import { useConversationStore, isUntitled } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { handleBrowserToolChunk } from "@/lib/sse/browser-tool-chunk";
import { useCanvasSseHandler } from "@/hooks/use-canvas-sse-handler";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { useProjectContext } from "@/hooks/use-project-context";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
import { Button } from "@/components/ui/button";
import { ConnectionSelector } from "@/components/shared/connection-selector";
import { Folder, Github, ListChecks } from "lucide-react";
import { PreviewPanel } from "@/components/shared/preview-panel";
import { PlanSheet } from "@/components/shared/plan-sheet";
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
import { DEFAULT_SESSION_CONTROLS } from "@/lib/slash-commands";
import { WorkspaceLayout } from "./workspace/workspace-layout";
import { tagSecurityWarning } from "./security-warning";
import { PermissionModeMenu } from "./permission-mode-menu";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useSurfaceTurn, type SessionControlsAccess } from "@/hooks/use-surface-turn";
import { useTurnSettings, memoriesFor, drainContextBus } from "@/hooks/use-turn-settings";

/** This surface's routing capability — a fixed property of the surface. */
const CAPABILITY = getSurfaceRoute("code").capability;

/** Slash-command settings live per conversation in the code store. */
const SESSION_CONTROLS: SessionControlsAccess = {
  get: (id) => useCodeStore.getState().sessionControls[id] ?? DEFAULT_SESSION_CONTROLS,
  set: (id, controls) => useCodeStore.getState().setSessionControls(id, controls),
};

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
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const chatId = useCodeStore((s) => s.currentChatId) ?? "";
  const onCanvas = useCanvasSseHandler("code");
  const modelRoute = useCodeStore((s) => s.modelRoute);
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
  const setModelRoute = useCodeStore((s) => s.setModelRoute);
  const setFolder = useCodeStore((s) => s.setFolder);
  const setPermissionMode = useCodeStore((s) => s.setPermissionMode);
  const addMessage = useCodeStore((s) => s.addMessage);
  const updateConversation = useConversationStore((s) => s.updateConversation);

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
  const [, setPreviewOpen] = useState(false);

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

  const { projectId: currentProjectId, projectInstructions, projectKnowledge, crossSurfaceContext } = useProjectContext(chatId, "code");
  const settings = useTurnSettings(chatId, { projectInstructions, projectKnowledge, crossSurfaceContext });
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);

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

  // Dropped files join the draft of the conversation on screen.
  const { isDragging, dropZoneProps } = useFileDrop(
    useCallback(
      (file: AttachmentFile) => addComposerAttachment("code", useCodeStore.getState().currentChatId ?? "", file),
      [],
    ),
  );

  const turn = useSurfaceTurn({
    surface: "code",
    label: "Code",
    store: useCodeStore,
    capability: CAPABILITY,
    modelRoute,
    sessionControls: SESSION_CONTROLS,
    onCanvas,
    // The folder picked before any conversation existed belongs to this one.
    onConversationCreated: (id) => {
      if (!pendingFolder) return;
      setFolder(id, pendingFolder);
      setPendingFolder(null);
    },
    request: async ({ text }) => ({
      ...settings,
      cwd: folder || undefined,
      /*
       * The mode in the composer's menu. It used to stay in the browser while
       * the server hard-coded "auto accept edits", so "Ask permissions" asked
       * nothing. Read at send time so a change made mid-conversation applies
       * to the very next turn.
       */
      permissionMode: useCodeStore.getState().permissionMode,
      /*
       * Only when the preview panel is actually open. The webview ref is null
       * when it is closed, and offering `navigate` with nothing to navigate is
       * DR-21's loop: the agent cannot discover that a step is impossible, so
       * it repeats it until the turn dies.
       */
      browserToolsAvailable: !!previewWebviewRef.current,
      // Scoped to the conversation's project, so memories from other folders
      // don't leak into this one.
      memories: memoriesFor(text, currentProjectId),
      contextBusEvents: await drainContextBus("code"),
    }),
    chunks: {
      /*
       * THE SHARED BROWSER RELAY. Code has ONE preview view, so its tab
       * callbacks are absent and the shared module answers new_tab/switch_tab
       * with "this surface shows a single page, not tabs — use navigate" rather
       * than "Unknown tool", which the agent would retry until the turn died.
       */
      before: (event, cid) =>
        handleBrowserToolChunk(event, {
          chatId: cid,
          webview: previewWebviewRef.current,
          consoleBuffer: consoleBufferRef.current,
          addToolCall: useCodeStore.getState().addToolCall,
          updateToolResult: useCodeStore.getState().updateToolResult,
          noWebviewMessage:
            'The preview panel is not open, so there is no page to act on. Write an HTML file or start a dev server first, or use WebFetch to read a URL.',
          surface: 'CodeSurface',
        }),
      core: (cid) => ({
        // Tag risky Bash commands — the same classifier as the server's gate.
        normaliseToolInput: (name, input) => tagSecurityWarning(name, input, useSettingsStore.getState()),
        onToolStarted: (_toolId, toolName, toolInput) => {
          if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
            const filePath = (toolInput.file_path || toolInput.notebook_path) as string | undefined;
            if (filePath) {
              // HTML opens in the preview when the turn ends; other web assets
              // refresh a preview that is already showing.
              if (/\.html?$/i.test(filePath)) {
                pendingHtmlFiles.current.push(filePath);
              } else if (isWebAsset(filePath)) {
                pendingWebAssets.current.push(filePath);
                triggerPreviewRefresh(filePath);
              }
              if (currentProjectId) {
                useProjectStore.getState().addArtifact(currentProjectId, {
                  id: crypto.randomUUID(),
                  name: filePath.split("/").pop() || filePath,
                  path: filePath,
                  type: "file",
                  surface: "code",
                  conversationId: cid,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                });
              }
            }
          }
          // Plan mode ends with the plan handed to ExitPlanMode — which the
          // server refuses, since only the user leaves plan mode. The plan
          // itself is still the deliverable, so it goes to the plan sheet.
          if (toolName === "ExitPlanMode" && typeof toolInput.plan === "string" && toolInput.plan) {
            setPlanContent(cid, toolInput.plan);
          }
          // Detect plan file writes
          if (toolName === "Write") {
            const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "";
            const content = typeof toolInput.content === "string" ? toolInput.content : "";
            // `<CLAUDE_CONFIG_DIR>/plans/<slug>.md` — the app's data dir, not
            // `~/.claude`, since the provider points CLAUDE_CONFIG_DIR there.
            if (/\/\.[^/]+\/plans\/[^/]+\.md$/.test(filePath) && content) setPlanContent(cid, content);
          }
        },
        onToolResult: (_toolId, output, isError) => {
          if (!output || isError) return;
          const detected = detectServerUrl(output);
          if (detected) { previewPathRef.current = null; setPreviewUrl(detected.url); }
        },
      }),
    },
    onDone: (cid) => {
      // Open the preview on any HTML written in this turn.
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
        void resolveWebAssetEntryPoint();
      }
      // Inline plan detection: check last assistant message for plan heading
      const lastMsg = useCodeStore.getState().messages[cid]?.at(-1);
      if (lastMsg?.role === "assistant" && lastMsg.content && /^#{1,2}\s+plan\b/im.test(lastMsg.content.slice(0, 500))) {
        setPlanContent(cid, lastMsg.content);
      }
    },
  });
  const { messages, isStreaming } = turn;
  const isEmpty = messages.length === 0;

  /*
   * The ONE submit — Enter and the button both land here. Goal mode is a
   * property of the send, not a second composer; a scheduled prompt goes
   * straight to the turn and never starts a goal because a toggle was left on.
   */
  function submitFromComposer(text: string, attachments: AttachmentFile[]): boolean {
    if (!turn.guardModel(text)) return false;
    if (goalMode) return startGoalFrom(text);
    void turn.submit(text, attachments);
    return true;
  }

  /** Goal mode: plan and start a run. Returns false — the draft stays until it has started. */
  function startGoalFrom(text: string): boolean {
    const settings = goalSettingsFrom(goalBudget, goalCap);
    if (typeof settings === "string") {
      setGoalError(settings);
      return false;
    }
    if (!folder) {
      setGoalError("Pick a folder first — the plan and progress live there.");
      return false;
    }
    // A goal needs a conversation; a brand new chat would post conversationId: "" and 400.
    if (!chatId) {
      setGoalError("Send a message first, or pick an existing chat — a goal needs a conversation to live in.");
      return false;
    }
    setGoalPending(text);
    void startGoal({ conversationId: chatId, workingDir: folder, objective: text, ...settings }).then((ok) => {
      setGoalPending(null);
      if (!ok) return;
      setGoalNudge((n) => n + 1);
      setGoalMode(false);
      const existing = useConversationStore.getState().conversations.find((c) => c.id === chatId);
      if (isUntitled(existing?.title)) {
        updateConversation(chatId, { title: text.length > 60 ? `${text.slice(0, 57)}…` : text });
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
    });
    // Kept until the goal has actually started — planning can still fail.
    return false;
  }

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
         * chosen. It used to wait for the first MESSAGE, so the file tree,
         * editor and terminal of the folder you had just picked were hidden
         * until you had asked the agent for something.
         */
        <WorkspaceLayout
          workspace={folder}
          chatId={chatId}
          /*
           * The preview is a DOCKVIEW PANEL, and mounted UNCONDITIONALLY: its
           * address bar is the only way for a user to SET a url, so a panel that
           * mounted only once a url was set could never be given one. The
           * content still belongs to the surface, which owns the webview's
           * lifecycle and hands its ref to the agent.
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
                  The same transcript as Chat and Cowork: error banners with
                  Try again, edit & resend, question AND connect cards. Code
                  had its own terminal-styled copy, which rendered no connect
                  card at all — a connector request here parked the turn for
                  300s with nothing on screen.
                */}
                {isEmpty ? (
                  <div
                    className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground animate-in fade-in duration-300"
                    data-testid="code-chat-empty"
                  >
                    <Mascot />
                    <p className="text-sm">What should we work on in this folder?</p>
                  </div>
                ) : (
                  <MessageList
                    {...turn.transcript}
                    surfaceId="code"
                    onPreviewUrl={(url) => { setPreviewUrl(url); setPreviewOpen(true); }}
                    showReasoning={sessionControls.reasoningVisible}
                    expandToolCalls={sessionControls.verboseMode}
                  />
                )}

                <div className="px-4 pb-3 pt-2 shrink-0">
                  <div className="max-w-3xl mx-auto">
                    <Composer
                      {...turn.composer}
                      onSubmit={submitFromComposer}
                      placeholder={isEmpty ? "Find a small todo in the codebase and do it" : "Describe a task..."}
                      submitDisabled={goalBusy}
                      submitLabel={goalMode ? "Plan and start the goal" : "Send message"}
                      mentionCwd={folder}
                      attachmentMenu={{
                        currentProjectId,
                        onAddToProject: (pid) => assignToProject(chatId, pid),
                        onNewProject: () => setSidebarMode("projects"),
                        projects: allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon })),
                      }}
                      header={
                        <>
                          {turn.noModelCard}
                          {/* The run's parked question, above the composer where the user is. */}
                          <GoalQuestion chatId={chatId} folder={folder} surfaceId="code" />
                        </>
                      }
                      belowInput={goalMode ? (
                        <GoalModeBar
                          budget={goalBudget} cap={goalCap}
                          onBudget={setGoalBudget} onCap={setGoalCap}
                          disabled={goalBusy} error={goalStartError}
                        />
                      ) : null}
                      toolbarStart={
                        <>
                          {planButton}
                          <GoalModeToggle on={goalMode} onChange={setGoalMode} disabled={goalBusy} />
                          <PermissionModeMenu value={permissionMode} onChange={setPermissionMode} />
                        </>
                      }
                      toolbarEnd={
                        <ModelSelector
                          value={modelRoute?.id ?? ""}
                          onSelectModel={setModelRoute}
                          capability={CAPABILITY}
                          className="border-0 bg-transparent shadow-none h-6 w-auto text-muted-foreground"
                        />
                      }
                    />
                    {/*
                      Run status, under the composer — not in the dockview panel,
                      which can fail to open. Feedback that a goal has started
                      must not depend on a panel being placeable.
                    */}
                    <GoalRunStatus
                      chatId={chatId} folder={folder} surfaceId="code"
                      nudge={goalNudge}
                      starting={
                        goalPending && goalPhase !== "idle"
                          ? { objective: goalPending, phase: goalPhase }
                          : null
                      }
                    />
                    <BottomBar folder={folder} onFolderChange={handleFolderChange} />
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
