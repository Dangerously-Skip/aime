"use client";

import { useState, useCallback, useRef } from "react";
import { useProjectStore, type Project, type KnowledgeFile } from "@/stores/project-store";
import { useConversationStore, type Conversation } from "@/stores/conversation-store";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream } from "@/hooks/use-sse-stream";
import { ModelSelector } from "@/components/shared/model-selector";
import { AttachmentMenu } from "@/components/shared/attachment-menu";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ArrowUp,
  Star,
  Ellipsis,
  ExternalLink,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Upload,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ProjectEditDialog } from "./project-edit-dialog";
import { ProjectIcon } from "@/components/shared/project-icon";

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

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
  onOpenSettings: (projectId: string) => void;
  onOpenConversation: (conversationId: string) => void;
}

export function ProjectDetail({
  projectId,
  onBack,
  onOpenSettings,
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
  const setModel = useChatStore((s) => s.setModel);
  const addMessage = useChatStore((s) => s.addMessage);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const appendToLastAssistant = useChatStore((s) => s.appendToLastAssistant);
  const addToolCall = useChatStore((s) => s.addToolCall);
  const updateToolResult = useChatStore((s) => s.updateToolResult);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const displayName = useSettingsStore((s) => s.displayName);
  const personalPreferences = useSettingsStore((s) => s.personalPreferences);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);

  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const knowledgeInputRef = useRef<HTMLInputElement>(null);

  const { sendMessage } = useSSEStream({
    onChunk() {},
    onDone() {},
    onError() {},
  });

  const projectConversations = conversations
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

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

    // Create conversation
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

    // Add messages
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

    // Build project context
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

    // Navigate to chat
    onOpenConversation(conv.id);

    // Send
    sendMessage(trimmed, conv.id, "chat", model, {
      personalPreferences: personalPreferences || undefined,
      displayName: displayName || undefined,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      projectInstructions,
      projectKnowledge,
      apiKey: nibGatewayApiKey || undefined,
    });
  }

  function handleStartCowork() {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: "New Cowork Task",
      surface: "cowork",
      lastMessage: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId,
    };
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
    <div className="flex flex-1 flex-col overflow-auto">
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
                value={model}
                onChange={setModel}
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

        {/* Start in Cowork link */}
        <button
          onClick={handleStartCowork}
          className="flex items-center justify-center gap-2 w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Start a task in Cowork
        </button>

        {/* Conversations list */}
        {projectConversations.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="space-y-0">
              {projectConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => onOpenConversation(conv.id)}
                  className="flex w-full items-center justify-between py-4 border-b border-border text-left hover:bg-muted/30 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {conv.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Last message {formatTimeAgo(conv.updatedAt)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Bottom section — Instructions & Knowledge Files */}
        <div className="mt-12 space-y-0">
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
