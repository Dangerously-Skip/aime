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
import { detectServerUrl } from "@/lib/artifacts/server-detector";
import { useElectron } from "@/hooks/use-electron";
import { VoiceButton } from "@/components/shared/voice-button";
import { EditorPicker } from "@/components/shared/editor-picker";

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
  />\s*(\S+)/,                          // echo "x" > file, cat > file
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
  // Explicit artifact tools
  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
    const raw = toolInput.file_path || toolInput.path || toolInput.notebook_path;
    return typeof raw === "string" ? { category: "artifact", path: raw } : null;
  }

  // Explicit context tools
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep" ||
      toolName === "WebSearch" || toolName === "WebFetch") {
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
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
  emptyText: string;
  onItemClick?: (path: string) => void;
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
                  onClick={() => onItemClick ? onItemClick(path) : openFile(path)}
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
  onContextClick,
  onArtifactClick,
  previewUrl,
  onPreviewClick,
}: {
  contextFiles: string[];
  artifactFiles: string[];
  folder: string | null;
  open: boolean;
  onToggle: () => void;
  onContextClick?: (path: string) => void;
  onArtifactClick?: (path: string) => void;
  previewUrl?: string | null;
  onPreviewClick?: () => void;
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
              onItemClick={onContextClick}
            />

            <SidebarCard
              label="Artifacts"
              icon={FilePen}
              items={artifactFiles}
              emptyText="Files created or edited will appear here."
              onItemClick={onArtifactClick}
            />

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
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
  const completeRunningTools = useCoworkStore((s) => s.completeRunningTools);
  const updateMessage = useCoworkStore((s) => s.updateMessage);
  const addContextFile = useCoworkStore((s) => s.addContextFile);
  const addArtifactFile = useCoworkStore((s) => s.addArtifactFile);
  const planContent = useCoworkStore((s) => (chatId ? s.planContent[chatId] : undefined));
  const planOpen = useCoworkStore((s) => s.planOpen);
  const setPlanContent = useCoworkStore((s) => s.setPlanContent);
  const setPlanOpen = useCoworkStore((s) => s.setPlanOpen);
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
  const blockDangerousCommands = useSettingsStore((s) => s.blockDangerousCommands);
  const blockNetworkCommands = useSettingsStore((s) => s.blockNetworkCommands);
  const restrictToProjectFolder = useSettingsStore((s) => s.restrictToProjectFolder);
  const disableBashTool = useSettingsStore((s) => s.disableBashTool);
  const { projectInstructions, projectKnowledge, projectId: currentProjectId, crossSurfaceContext, projectFolder } = useProjectContext(chatId, "cowork");
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const scratchDir = useScratchDir(chatId);
  const { handleFolderSelected } = useAutoProject('cowork');
  const { showNotification } = useElectron();

  const handleFolderChange = useCallback(
    (f: string | null) => {
      setFolder(f);
      if (f && chatId) {
        handleFolderSelected(f, chatId);
      }
    },
    [setFolder, chatId, handleFolderSelected]
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
            if (matchingTc?.name === "Bash") {
              const coworkFolder = useCoworkStore.getState().folder;
              BASH_ARTIFACT_EXT.lastIndex = 0;
              let m;
              while ((m = BASH_ARTIFACT_EXT.exec(result)) !== null) {
                let filePath = m[1];
                if (!filePath.startsWith("/") && coworkFolder) {
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
      // Detect binary artifacts mentioned in assistant text (e.g. "saved to presentation.pptx")
      // Only scan if the conversation had Bash tool calls (avoids false positives)
      if (chatId && allMsgs) {
        const hasBashCalls = allMsgs.some(
          (m) => m.role === "assistant" && m.toolCalls?.some((tc) => tc.name === "Bash"),
        );
        if (hasBashCalls) {
          const currentArtifacts = useCoworkStore.getState().artifactFiles[chatId] ?? [];
          const coworkFolder = useCoworkStore.getState().folder;
          for (const m of allMsgs) {
            if (m.role === "assistant" && m.content) {
              BASH_ARTIFACT_EXT.lastIndex = 0;
              let match;
              while ((match = BASH_ARTIFACT_EXT.exec(m.content)) !== null) {
                let filePath = match[1];
                // Skip obvious non-file mentions (e.g. "use .pptx format")
                if (filePath.length < 3 || filePath.startsWith(".")) continue;
                // Resolve relative paths against cowork folder
                if (!filePath.startsWith("/") && coworkFolder) {
                  filePath = `${coworkFolder}/${filePath}`;
                }
                if (!currentArtifacts.includes(filePath)) {
                  addArtifactFile(chatId, filePath);
                  currentArtifacts.push(filePath); // avoid duplicates in this loop
                }
              }
            }
          }
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
          title: truncateAtWordBoundary(trimmed, 50),
          surface: "cowork",
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
        <div className="flex flex-1 min-h-0">
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
            previewUrl={previewUrl}
            onPreviewClick={() => setPreviewOpen(true)}
          />

          {/* Dev server preview panel */}
          {previewUrl && (
            <PreviewPanel
              url={previewUrl}
              open={previewOpen}
              onClose={() => setPreviewOpen(false)}
            />
          )}
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
