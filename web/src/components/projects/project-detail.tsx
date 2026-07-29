"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { useProjectStore, type KnowledgeFile } from "@/stores/project-store";
import { useConversationStore, type Conversation } from "@/stores/conversation-store";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream } from "@/hooks/use-sse-stream";
import { buildProjectContext } from "@/lib/project/context-builder";
import { ModelSelector } from "@/components/shared/model-selector";
import { AttachmentMenu } from "@/components/shared/attachment-menu";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Surface } from "@/stores/app-store";
import {
  ArrowLeft,
  ArrowUp,
  Star,
  Ellipsis,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Upload,
  X,
  MessageCircle,
  Briefcase,
  Terminal,
  Globe,
  Timer,
  ToggleLeft,
  ToggleRight,
  Users,
  Bot,
} from "lucide-react";
import { useCronStore } from "@/stores/cron-store";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ProjectEditDialog } from "./project-edit-dialog";
import { ProjectIcon } from "@/components/shared/project-icon";
import { ProjectCanvases } from "./project-canvases";
import { useProviderStore } from "@/stores/provider-store";
import { resolveSendRoute } from "@/lib/models/client-options";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useTurnWiring } from "@/hooks/use-turn-wiring";
import { useBuiltinAccess } from "@/hooks/use-builtin-access";

/** Project chats run on the chat surface, so they route with its capability. */
const CAPABILITY = getSurfaceRoute("chat").capability;

const SURFACE_CONFIG: Record<
  Surface,
  { icon: React.ComponentType<{ className?: string }>; label: string; color: string }
> = {
  chat: { icon: MessageCircle, label: "Chat", color: "bg-blue-500/10 text-blue-600" },
  cowork: { icon: Briefcase, label: "Cowork", color: "bg-purple-500/10 text-purple-600" },
  code: { icon: Terminal, label: "Code", color: "bg-green-500/10 text-green-600" },
  browser: { icon: Globe, label: "Browser", color: "bg-orange-500/10 text-orange-600" },
  assistant: { icon: Bot, label: "Assistant", color: "bg-pink-500/10 text-pink-600" },
};

const SURFACE_ORDER: Surface[] = ["chat", "cowork", "code", "browser", "assistant"];

const NEW_CONVERSATION_LABELS: Record<Surface, string> = {
  chat: "New Chat",
  cowork: "New Cowork Task",
  code: "New Code Session",
  browser: "New Browser Session",
  assistant: "New Assistant Session",
};

/** Module-scoped: reads the wall clock, which must not happen in a component body. */
function newSurfaceConversation(surface: Surface, projectId: string): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: NEW_CONVERSATION_LABELS[surface],
    surface,
    lastMessage: "",
    createdAt: now,
    updatedAt: now,
    projectId,
  };
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? "s" : ""} ago`;
}

function SurfaceBadge({ surface }: { surface: string }) {
  const config = SURFACE_CONFIG[surface as Surface];
  if (!config) return null;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.color}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
  onOpenSettings: (projectId: string) => void;
  onOpenConversation: (conversationId: string) => void;
}

export function ProjectDetail({
  projectId,
  onBack,
  // onOpenSettings is part of the props contract but unused here — project
  // settings are reached from the sidebar, not this view.
  onOpenConversation,
}: ProjectDetailProps) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjectStore((s) => s.updateProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const addKnowledgeFile = useProjectStore((s) => s.addKnowledgeFile);
  const removeKnowledgeFile = useProjectStore((s) => s.removeKnowledgeFile);
  const conversations = useConversationStore((s) => s.conversations);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);

  const model = useChatStore((s) => s.model);
  const modelRoute = useChatStore((s) => s.modelRoute);
  const setModel = useChatStore((s) => s.setModel);
  const setModelRoute = useChatStore((s) => s.setModelRoute);
  const addMessage = useChatStore((s) => s.addMessage);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const appendToLastAssistant = useChatStore((s) => s.appendToLastAssistant);
  const addToolCall = useChatStore((s) => s.addToolCall);
  const updateToolResult = useChatStore((s) => s.updateToolResult);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const setIsStreaming = useChatStore((s) => s.setIsStreaming);
  const displayName = useSettingsStore((s) => s.displayName);
  const personalPreferences = useSettingsStore((s) => s.personalPreferences);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  // Built-in (Claude) reachability, which is the user's key OR the server's env
  // key OR Bedrock — `anthropicApiKey` alone only knows about the first.
  const { hasAnthropicKey, hasBedrock, known: builtinAccessKnown } = useBuiltinAccess();
  const tierModels = useSettingsStore((s) => s.tierModels);
  const providers = useProviderStore((s) => s.providers);

  const allCronJobs = useCronStore((s) => s.jobs);
  const cronJobs = useMemo(() => allCronJobs.filter((j) => j.projectId === projectId), [allCronJobs, projectId]);
  const addCronJob = useCronStore((s) => s.addJob);
  const removeCronJob = useCronStore((s) => s.removeJob);
  const toggleCronJob = useCronStore((s) => s.toggleJob);

  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [addingCron, setAddingCron] = useState(false);
  const [cronExpr, setCronExpr] = useState("");
  const [cronPrompt, setCronPrompt] = useState("");
  const [cronSurface, setCronSurface] = useState("cowork");
  const [cronError, setCronError] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [surfaceFilter, setSurfaceFilter] = useState<Surface | "all">("all");
  const knowledgeInputRef = useRef<HTMLInputElement>(null);
  // Track the conversation id launched from this page so SSE handlers can target it
  const launchedConvIdRef = useRef<string>("");
  const [activeChatId, setActiveChatId] = useState("");

  // Scoped to the conversation this page launched, so an abort here cannot close
  // the Chat surface's Run — both record against the 'chat' surface.
  const ownsChat = useCallback(
    (id: string) => !!id && id === launchedConvIdRef.current,
    [],
  );
  // Shared with the three surfaces (see use-turn-wiring). No `updateMessage`: this
  // page renders no question or connect cards, so the answer persisters are
  // deliberately inert rather than wired to a list that would never show one.
  const { runRecorder } = useTurnWiring({
    surfaceId: "chat",
    chatId: activeChatId,
    ownsChat,
  });

  const { sendMessage } = useSSEStream({
    chatId: activeChatId,
    setIsStreaming,
    onUsage: runRecorder.onUsage,
    onChunk(event) {
      const cid = launchedConvIdRef.current;
      if (!cid) return;
      switch (event.type) {
        case "text":
          appendToLastAssistant(cid, (event.content as string) || "");
          break;
        case "tool_use": {
          addToolCall(cid, {
            id: (event.id as string) || `tool_${Date.now()}`,
            name: (event.name as string) || "Unknown",
            input: (event.input as Record<string, unknown>) || {},
            status: "running",
            startTime: Date.now(),
          });
          break;
        }
        case "tool_result": {
          const id = (event.tool_use_id as string) || (event.id as string) || "";
          const result = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
          updateToolResult(cid, id, result, event.is_error as boolean | undefined);
          break;
        }
        case "error":
          appendToLastAssistant(cid, `\n\n**Error:** ${(event.message as string) || "An error occurred"}`);
          break;
      }
    },
    onDone() {
      runRecorder.succeed();
      const cid = launchedConvIdRef.current;
      if (cid) {
        stopStreaming(cid);
      }
    },
    onError(error) {
      runRecorder.fail(error.message);
      const cid = launchedConvIdRef.current;
      if (cid) {
        stopStreaming(cid);
        appendToLastAssistant(cid, `\n\n**Error:** ${error.message}`);
      }
    },
  });

  const projectConversations = conversations
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const filteredConversations =
    surfaceFilter === "all"
      ? projectConversations
      : projectConversations.filter((c) => c.surface === surfaceFilter);

  // Count conversations per surface for filter tabs
  const surfaceCounts: Record<string, number> = {};
  for (const conv of projectConversations) {
    surfaceCounts[conv.surface] = (surfaceCounts[conv.surface] || 0) + 1;
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Project not found
      </div>
    );
  }

  function handleStartChat() {
    if (!inputValue.trim()) return;
    const trimmed = inputValue.trim();

    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: trimmed.substring(0, 50),
      surface: "chat",
      lastMessage: trimmed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId,
    };
    addConversation(conv);
    setActiveConversation(conv.id);
    launchedConvIdRef.current = conv.id;
    setActiveChatId(conv.id);

    addMessage(conv.id, {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    });
    addMessage(conv.id, {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isLoading: true,
      isStreaming: true,
    });
    startStreaming(conv.id);

    let projectInstructions: string | undefined;
    let projectKnowledge: string | undefined;
    if (project!.customInstructions) {
      projectInstructions = project!.customInstructions;
    }
    if (project!.knowledgeFiles.length > 0) {
      projectKnowledge = project!.knowledgeFiles
        .map((f) => `[File: ${f.name}]\n${f.content}`)
        .join("\n\n---\n\n");
    }

    const currentAttachments = [...attachments];
    setInputValue("");
    setAttachments([]);

    onOpenConversation(conv.id);

    const crossSurfaceContext = buildProjectContext(project!, "chat", conv.id);

    // A tier route resolves here (it can land on a user provider's model); a
    // pinned model passes through. Null ⇒ nothing resolved, so fall back to the
    // built-in model rather than send an empty one.
    const route = resolveSendRoute(modelRoute, providers, {
      capability: CAPABILITY,
      tierModels,
      hasAnthropicKey,
      hasBedrock,
      known: builtinAccessKnown,
    });

    // Open the run record before the turn starts so an immediate failure is
    // still attributed rather than lost.
    runRecorder.begin({ trigger: "chat", model: route?.model ?? model });
    sendMessage(trimmed, conv.id, "chat", route?.model ?? model, {
      personalPreferences: personalPreferences || undefined,
      displayName: displayName || undefined,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      projectInstructions,
      projectKnowledge,
      crossSurfaceContext: crossSurfaceContext || undefined,
      apiKey: anthropicApiKey || undefined,
      providerConfig: route?.providerConfig,
    });
  }

  function handleStartInSurface(surface: Surface) {
    const conv = newSurfaceConversation(surface, projectId);
    addConversation(conv);
    setActiveConversation(conv.id);
    onOpenConversation(conv.id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleStartChat();
    }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputValue(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }

  function handleDelete() {
    removeProject(projectId);
    onBack();
  }

  async function handleAddCron() {
    setCronError("");
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) { setCronError("Must have 5 fields: min hour dom month dow"); return; }
    if (!cronPrompt.trim()) { setCronError("Prompt is required"); return; }
    const res = await fetch("/api/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression: cronExpr.trim(), prompt: cronPrompt.trim(), surfaceId: cronSurface }),
    });
    if (!res.ok) { const d = await res.json() as { error?: string }; setCronError(d.error ?? "Invalid"); return; }
    addCronJob({ expression: cronExpr.trim(), prompt: cronPrompt.trim(), surfaceId: cronSurface, projectId, enabled: true });
    setCronExpr(""); setCronPrompt(""); setAddingCron(false);
  }

  function startEditInstructions() {
    setInstructionsDraft(project!.customInstructions);
    setEditingInstructions(true);
  }

  function saveInstructions() {
    updateProject(projectId, { customInstructions: instructionsDraft });
    setEditingInstructions(false);
  }

  function handleKnowledgeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = () => {
        const kf: KnowledgeFile = {
          id: crypto.randomUUID(),
          name: file.name,
          content: reader.result as string,
          type: file.type || "text/plain",
          size: file.size,
          addedAt: Date.now(),
        };
        const error = addKnowledgeFile(projectId, kf);
        if (error) alert(error);
      };
      reader.readAsText(file);
    }
    e.target.value = "";
  }

  return (
    <div className="h-full overflow-auto">
      <div className="w-full max-w-3xl mx-auto px-6 py-8">
        {/* Back link */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All projects
        </button>

        {/* Project header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <ProjectIcon icon={project.icon} className="h-7 w-7 text-muted-foreground" />
            <h1 className="text-3xl font-light text-foreground tracking-tight">
              {project.name}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" />
                }
              >
                <Ellipsis className="h-5 w-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
                  <Pencil className="h-4 w-4" />
                  Edit details
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => updateProject(projectId, { starred: !project.starred })}
            >
              <Star
                className={`h-5 w-5 ${
                  project.starred
                    ? "fill-amber-400 text-amber-400"
                    : ""
                }`}
              />
            </Button>
          </div>
        </div>

        {/* Description */}
        {project.description && (
          <p className="text-sm text-muted-foreground mb-8">{project.description}</p>
        )}
        {!project.description && <div className="mb-6" />}

        {/* Chat input card */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden mb-4">
          <Textarea
            value={inputValue}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="How can I help you today?"
            rows={2}
            className="min-h-[56px] max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pb-0"
          />
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
              onWebSearchToggle={() => {}}
              webSearchEnabled={false}
            />
            <div className="flex items-center gap-2">
              <ModelSelector
                value={modelRoute ? modelRoute.id : model}
                onChange={setModel}
                onSelectModel={(opt) => setModelRoute(opt.kind === 'tier' || opt.providerConfig ? opt : null)}
                capability={CAPABILITY}
                className="border-0 bg-transparent shadow-none h-6 w-auto text-muted-foreground"
              />
              <Button
                size="icon"
                className="h-8 w-8 rounded-full bg-primary hover:bg-primary/80"
                onClick={handleStartChat}
                disabled={!inputValue.trim()}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Surface launcher buttons */}
        <div className="flex items-center justify-center gap-3 mb-2">
          {(["cowork", "code", "browser"] as Surface[]).map((surface) => {
            const config = SURFACE_CONFIG[surface];
            const Icon = config.icon;
            return (
              <button
                key={surface}
                onClick={() => handleStartInSurface(surface)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <Icon className="h-3.5 w-3.5" />
                Start in {config.label}
              </button>
            );
          })}
        </div>

        {/* Conversations list */}
        {projectConversations.length > 0 && (
          <>
            <Separator className="my-4" />

            {/* Surface filter tabs */}
            <div className="flex items-center gap-1 mb-4">
              <button
                onClick={() => setSurfaceFilter("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  surfaceFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                All ({projectConversations.length})
              </button>
              {SURFACE_ORDER.filter((s) => surfaceCounts[s]).map((surface) => {
                const config = SURFACE_CONFIG[surface];
                const Icon = config.icon;
                return (
                  <button
                    key={surface}
                    onClick={() => setSurfaceFilter(surface)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      surfaceFilter === surface
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {config.label} ({surfaceCounts[surface]})
                  </button>
                );
              })}
            </div>

            <div className="space-y-0">
              {filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => onOpenConversation(conv.id)}
                  className="flex w-full items-center justify-between py-4 border-b border-border text-left hover:bg-muted/30 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">
                          {conv.title}
                        </p>
                        <SurfaceBadge surface={conv.surface} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Last message {formatTimeAgo(conv.updatedAt)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Pinned canvases */}
        <ProjectCanvases projectId={projectId} />

        {/* Automations */}
        <div className="mt-8">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Timer className="h-4 w-4 text-muted-foreground" />
                Automations
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => setAddingCron((v) => !v)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {addingCron && (
              <div className="p-4 border-b border-border space-y-3 bg-muted/20">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Cron Expression</label>
                  <input
                    value={cronExpr}
                    onChange={(e) => setCronExpr(e.target.value)}
                    placeholder="0 9 * * 1"
                    className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="text-[11px] text-muted-foreground">min hour dom month dow — e.g. every Monday 9am</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Prompt</label>
                  <input
                    value={cronPrompt}
                    onChange={(e) => setCronPrompt(e.target.value)}
                    placeholder="Summarize this week's progress"
                    className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Surface</label>
                  <select
                    value={cronSurface}
                    onChange={(e) => setCronSurface(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none"
                  >
                    <option value="cowork">Cowork</option>
                    <option value="chat">Chat</option>
                    <option value="code">Code</option>
                  </select>
                </div>
                {cronError && <p className="text-xs text-destructive">{cronError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddCron}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAddingCron(false); setCronError(""); }}>Cancel</Button>
                </div>
              </div>
            )}

            {cronJobs.length === 0 && !addingCron ? (
              <div className="px-5 py-6 text-xs text-muted-foreground">
                No automations yet. Add a cron job to schedule recurring agent runs for this project.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {cronJobs.map((job) => (
                  <div key={job.id} className="flex items-start gap-3 px-5 py-3">
                    <button
                      onClick={() => toggleCronJob(job.id)}
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      title={job.enabled ? "Disable" : "Enable"}
                    >
                      {job.enabled
                        ? <ToggleRight className="h-4 w-4 text-primary" />
                        : <ToggleLeft className="h-4 w-4" />
                      }
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-muted-foreground">{job.expression}</p>
                      <p className="text-sm mt-0.5 truncate">{job.prompt}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{job.surfaceId}</span>
                        {job.lastRun && (
                          <span className="text-[10px] text-muted-foreground">
                            last run {formatTimeAgo(job.lastRun)}
                          </span>
                        )}
                        {!job.enabled && (
                          <span className="text-[10px] text-muted-foreground italic">disabled</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeCronJob(job.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors mt-0.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom section — Instructions & Knowledge Files */}
        <div className="mt-6 space-y-0">
          {/* Instructions */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Instructions</h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={startEditInstructions}
              >
                {project.customInstructions ? (
                  <Pencil className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
            {editingInstructions ? (
              <div className="p-4 space-y-3">
                <Textarea
                  value={instructionsDraft}
                  onChange={(e) => setInstructionsDraft(e.target.value)}
                  placeholder="Add instructions to tailor Claude's responses..."
                  rows={4}
                  className="resize-none text-sm"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingInstructions(false)}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveInstructions}>
                    Save
                  </Button>
                </div>
              </div>
            ) : project.customInstructions ? (
              <div className="px-5 py-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
                  {project.customInstructions}
                </p>
              </div>
            ) : (
              <div className="px-5 py-3">
                <p className="text-sm text-muted-foreground">
                  Add instructions to tailor Claude&apos;s responses
                </p>
              </div>
            )}
          </div>

          {/* Knowledge Files */}
          <div className="rounded-xl border border-border bg-card overflow-hidden mt-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Files</h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => knowledgeInputRef.current?.click()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <input
              ref={knowledgeInputRef}
              type="file"
              multiple
              accept=".txt,.md,.csv,.json,.xml,.js,.ts,.py,.go,.rs,.rb,.java,.c,.cpp,.h,.css,.html,.yml,.yaml,.toml,.sql,.sh,.log,.pdf"
              className="hidden"
              onChange={handleKnowledgeUpload}
            />

            {project.knowledgeFiles.length > 0 ? (
              <div className="p-3 space-y-1">
                {project.knowledgeFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1 text-foreground">{file.name}</span>
                    <button
                      onClick={() => removeKnowledgeFile(projectId, file.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-8 text-center">
                <button
                  onClick={() => knowledgeInputRef.current?.click()}
                  className="inline-flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Upload className="h-8 w-8 opacity-40" />
                  <span className="text-sm">
                    Add PDFs, documents, or other text to reference in this project.
                  </span>
                </button>
              </div>
            )}
          </div>
        {/* Team / Multiplayer — Coming Soon */}
        <div className="mt-4 rounded-xl border border-border/50 bg-card/50 overflow-hidden opacity-50 pointer-events-none select-none">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team
            </h3>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
              Multiplayer Mode Coming Soon
            </span>
          </div>
          <div className="px-5 py-4 space-y-3">
            {/* Fake member rows */}
            {["Project Owner", "Collaborator", "Viewer"].map((role) => (
              <div key={role} className="flex items-center gap-3">
                <div className="h-7 w-7 rounded-full bg-muted border border-border/50 shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="h-2.5 w-24 rounded bg-muted" />
                  <div className="h-2 w-16 rounded bg-muted/60" />
                </div>
                <div className="h-5 w-14 rounded-full bg-muted/60" />
              </div>
            ))}
            <div className="pt-1">
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border/50 px-3 py-2 text-xs text-muted-foreground/60">
                <Plus className="h-3.5 w-3.5" />
                Invite teammate
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      <ProjectEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        name={project.name}
        description={project.description}
        icon={project.icon || "folder"}
        onSave={(name, description, icon) => updateProject(projectId, { name, description, icon })}
      />
    </div>
  );
}
