"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MessageList } from "@/components/shared/message-list";
import { ModelSelector } from "@/components/shared/model-selector";
import { ChatTitleBar } from "@/components/shared/chat-title-bar";
import { useChatStore } from "@/stores/chat-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { FileText, FilePen, PanelRight, PanelRightClose, LayoutDashboard, Pencil, Sparkles, Code2, Lightbulb } from "lucide-react";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { Composer, type ComposerHandle } from "@/components/shared/composer/composer";
import { addComposerAttachment, setComposerText } from "@/components/shared/composer/draft-store";
import { useProjectContext } from "@/hooks/use-project-context";
import { useFileDrop } from "@/hooks/use-file-drop";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
import { ArtifactPanel } from "@/components/shared/artifact-panel";
import type { ParsedArtifact } from "@/lib/artifacts/parser";
import { DEFAULT_SESSION_CONTROLS } from "@/lib/slash-commands";
import { useCanvasStore } from "@/stores/canvas-store";
import { CanvasOverlay } from "@/components/shared/canvas-overlay";
import { useCanvasSseHandler } from "@/hooks/use-canvas-sse-handler";
import type { CanvasArtifact } from "@/stores/chat-store";
import { FilePreviewSheet } from "@/components/shared/file-preview-sheet";
import { categorizeToolCall, isValidSidebarEntry } from "@/lib/artifact-tracker";
import { artifactsOf } from "./artifacts-of";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useSurfaceTurn, type SessionControlsAccess } from "@/hooks/use-surface-turn";
import { useTurnSettings, memoriesFor } from "@/hooks/use-turn-settings";

/** This surface's routing capability — a fixed property of the surface. */
const CAPABILITY = getSurfaceRoute("chat").capability;

const EMPTY_SUGGESTIONS: string[] = [];
const EMPTY_CANVAS_ARTIFACTS: CanvasArtifact[] = [];

/** Slash-command settings live per conversation in the chat store. */
const SESSION_CONTROLS: SessionControlsAccess = {
  get: (id) => useChatStore.getState().sessionControls[id] ?? DEFAULT_SESSION_CONTROLS,
  set: (id, controls) => useChatStore.getState().setSessionControls(id, controls),
};

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
  const chatId = useChatStore((s) => s.currentChatId) ?? "";
  const onCanvas = useCanvasSseHandler("chat");
  const canvasArtifacts = useChatStore((s) => (chatId ? s.canvasArtifacts[chatId] : undefined) ?? EMPTY_CANVAS_ARTIFACTS);
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const setCanvasOpen = useCanvasStore((s) => s.setOpen);
  // Local: collapse/expand the right Artifacts column
  const [artifactsSidebarOpen, setArtifactsSidebarOpen] = useState(true);

  const modelRoute = useChatStore((s) => s.modelRoute);
  const setModelRoute = useChatStore((s) => s.setModelRoute);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const removeConversation = useConversationStore((s) => s.removeConversation);
  const chatTitle = useConversationStore((s) => s.conversations.find((c) => c.id === chatId)?.title) || "New conversation";
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const displayName = useSettingsStore((s) => s.displayName);
  const toolProfile = useSettingsStore((s) => s.toolProfile);
  const suggestions = useChatStore((s) => chatId ? (s.suggestions[chatId] ?? EMPTY_SUGGESTIONS) : EMPTY_SUGGESTIONS);
  const sessionControls = useChatStore((s) => (chatId ? s.sessionControls[chatId] : undefined) ?? DEFAULT_SESSION_CONTROLS);
  const { projectInstructions, projectKnowledge, projectName, projectIcon, projectId: currentProjectId, crossSurfaceContext, projectFolder } = useProjectContext(chatId, "chat");
  /*
   * The settings half of a turn, which Chat alone once sent none of: a chosen
   * deck theme never reached the model (every deck came back an unstyled pptx)
   * and search resolved to `none`. Built by the one hook every surface uses.
   */
  const settings = useTurnSettings(chatId, { projectInstructions, projectKnowledge, crossSurfaceContext });
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const navigateToProject = useAppStore((s) => s.navigateToProject);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);

  const turn = useSurfaceTurn({
    surface: "chat",
    label: "Chat",
    store: useChatStore,
    capability: CAPABILITY,
    modelRoute,
    sessionControls: SESSION_CONTROLS,
    trigger: "chat",
    onCanvas,
    summarizeOnLeave: true,
    request: ({ chatId: id, text }) => {
      if (currentProjectId) useProjectStore.getState().addConversationToProject(currentProjectId, "chat", id);
      // A new turn's suggestions replace the last one's.
      useChatStore.getState().clearSuggestions(id);
      return { ...settings, toolProfile, memories: memoriesFor(text, currentProjectId) };
    },
    chunks: {
      // Chat's one difference on a tool call: a written file is filed against
      // the project. The artifact panel itself reads the transcript.
      core: (cid) => ({
        onToolStarted: (_toolId, toolName, toolInput) => {
          const categorized = categorizeToolCall(toolName, toolInput);
          if (categorized?.category !== "artifact" || !isValidSidebarEntry(categorized.path)) return;
          if (!currentProjectId) return;
          useProjectStore.getState().addArtifact(currentProjectId, {
            id: crypto.randomUUID(),
            name: categorized.path.split("/").pop() || categorized.path,
            path: categorized.path,
            type: "file",
            surface: "chat",
            conversationId: cid,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        },
      }),
      after: (event, cid) => {
        if (event.type === "prompt_suggestion") {
          const suggestion = event.suggestion as string;
          if (suggestion) useChatStore.getState().addSuggestion(cid, suggestion);
        } else if (event.type === "document_extracted") {
          const extractedText = event.extractedText as string | undefined;
          if (!extractedText || !cid) return;
          const msgs = useChatStore.getState().messages[cid] || [];
          const lastUser = msgs.findLast((m) => m.role === "user");
          if (lastUser) {
            const docBlock = `\n\n<document name="${event.name as string}">\n${extractedText}\n</document>`;
            useChatStore.getState().updateMessageContent(cid, lastUser.id, lastUser.content + docBlock);
          }
        }
      },
    },
  });
  const { messages, isStreaming } = turn;
  const isEmpty = messages.length === 0;

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

  // The preview is a transient panel; the next conversation cannot derive it.
  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current === chatId) return;
    prevChatIdRef.current = chatId;
    setPreviewPath(null);
  }, [chatId]);

  // Web search is a per-message switch: it applies to this send only.
  const submitFromComposer = useCallback(
    (text: string, attachments: AttachmentFile[]) => {
      if (!turn.guardModel(text)) return false;
      const webSearch = webSearchEnabled;
      setWebSearchEnabled(false);
      void turn.submit(text, attachments, webSearch ? { webSearch: true } : undefined);
    },
    [turn, webSearchEnabled],
  );

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

  const composerProps = {
    ...turn.composer,
    ref: composerRef,
    onSubmit: submitFromComposer,
    attachmentMenu,
    toolbarEnd: modelSelector,
  };

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
            <Composer {...composerProps} variant="hero" placeholder="How can I help you today?" />

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
              <MessageList {...turn.transcript} surfaceId="chat" onArtifactClick={handleArtifactClick} showReasoning={sessionControls.reasoningVisible} expandToolCalls={sessionControls.verboseMode} />

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
                  <Composer {...composerProps} placeholder="Reply..." />
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
                  aria-label="Show artifacts"
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
                    aria-label="Hide artifacts"
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
