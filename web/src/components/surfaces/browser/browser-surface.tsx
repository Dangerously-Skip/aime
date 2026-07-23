"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { InputArea } from "@/components/shared/input-area";
import { MessageList } from "@/components/shared/message-list";
import { useBrowserStore } from "@/stores/browser-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useBrowserAgent } from "@/hooks/use-browser-agent";
import { useMemoryStore } from "@/stores/memory-store";
import { formatMemoriesForPrompt } from "@/lib/memory/retriever";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { useProjectContext } from "@/hooks/use-project-context";
import { AttachmentMenu } from "@/components/shared/attachment-menu";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
import { useHydrated } from "@/components/store-hydration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Message } from "@/stores/chat-store";
import { ConsoleLogBuffer, type WebviewRef } from "@/lib/browser-tools";
import {
  getInspectorInjectionScript,
  getInspectorCleanupScript,
  getInspectorPollScript,
  getSelectionScript,
  getSelectionListenerScript,
  getSelectionCleanupScript,
  captureScreenshot,
  formatElementContext,
  type InspectorResult,
  type PendingContextItem,
} from "@/lib/browser-interactions";
import { VoiceButton } from "@/components/shared/voice-button";
import { CommandPicker, type CommandSuggestion } from "@/components/shared/command-picker";
import {
  parseSlashCommand,
  applySlashCommand,
  getSlashSuggestions,
  DEFAULT_SESSION_CONTROLS,
  type SessionControls,
} from "@/lib/slash-commands";
import {
  Globe,
  Plus,
  X,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  PanelRightClose,
  PanelRight,
  GripVertical,
  Eye,
  Brain,
  Zap,
  Crosshair,
  Type,
  Camera,
  MessageSquare,
} from "lucide-react";

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TABS: import("@/stores/browser-store").BrowserTab[] = [];

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9]+([\-\.][a-z0-9]+)*\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

const PHASE_LABELS = {
  idle: null,
  observing: { icon: Eye, text: "Observing page..." },
  thinking: { icon: Brain, text: "Thinking..." },
  acting: { icon: Zap, text: "Acting..." },
} as const;

export function BrowserSurface() {
  const [inputValue, setInputValue] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [agentVisible, setAgentVisible] = useState(true);
  const [panelWidth, setPanelWidth] = useState(350);
  const [attachments, setAttachments] = useState<import("@/components/shared/attachment-menu").AttachmentFile[]>([]);
  const [slashSuggestions, setSlashSuggestions] = useState<CommandSuggestion[]>([]);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(0);
  const [sessionControls, setSessionControls] = useState<SessionControls>(DEFAULT_SESSION_CONTROLS);
  const webviewNodeRef = useRef<(HTMLElement & WebviewRef) | null>(null);
  const resizingRef = useRef(false);
  const inspectorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consoleBufferRef = useRef(new ConsoleLogBuffer());
  const [selectionInfo, setSelectionInfo] = useState<{ text: string; x: number; y: number } | null>(null);
  // Decoupled from activeTab.url to prevent circular navigation:
  // did-navigate → store update → src change → re-navigate → ERR_ABORTED
  const [webviewSrc, setWebviewSrc] = useState("");
  const prevActiveTabIdRef = useRef<string | null>(null);

  const hydrated = useHydrated();
  const addTab = useBrowserStore((s) => s.addTab);
  const removeTab = useBrowserStore((s) => s.removeTab);
  const setActiveTab = useBrowserStore((s) => s.setActiveTab);
  const updateTabUrl = useBrowserStore((s) => s.updateTabUrl);
  const currentChatId = useBrowserStore((s) => s.currentChatId);
  const chatId = currentChatId ?? "";
  const tabs = useBrowserStore((s) => (chatId ? s.tabSessions[chatId] : undefined) ?? EMPTY_TABS);
  const activeTabId = useBrowserStore((s) => chatId ? (s.activeTabIds[chatId] ?? null) : null);
  const messages = useBrowserStore(
    (s) => (s.currentChatId ? s.messages[s.currentChatId] : undefined) ?? EMPTY_MESSAGES
  );
  const model = useBrowserStore((s) => s.model);
  const isStreaming = useBrowserStore((s) => s.isStreaming);
  const loopPhase = useBrowserStore((s) => s.loopPhase);
  const addMessage = useBrowserStore((s) => s.addMessage);
  const appendToLastAssistant = useBrowserStore((s) => s.appendToLastAssistant);
  const addToolCall = useBrowserStore((s) => s.addToolCall);
  const updateToolResult = useBrowserStore((s) => s.updateToolResult);
  const startStreaming = useBrowserStore((s) => s.startStreaming);
  const stopStreaming = useBrowserStore((s) => s.stopStreaming);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const setCurrentChat = useBrowserStore((s) => s.setCurrentChat);
  const setLoopPhase = useBrowserStore((s) => s.setLoopPhase);
  const inspectorMode = useBrowserStore((s) => s.inspectorMode);
  const setInspectorMode = useBrowserStore((s) => s.setInspectorMode);
  const pendingContext = useBrowserStore((s) => s.pendingContext);
  const addPendingContext = useBrowserStore((s) => s.addPendingContext);
  const removePendingContext = useBrowserStore((s) => s.removePendingContext);
  const clearPendingContext = useBrowserStore((s) => s.clearPendingContext);

  const updateConversation = useConversationStore((s) => s.updateConversation);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const activeConvId = useConversationStore((s) => s.activeId);
  const allConversations = useConversationStore((s) => s.conversations);

  const { projectId: currentProjectId } = useProjectContext(chatId, "browser");
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // ── Callback ref for webview event listeners ────────────────────────────
  const CONSOLE_LEVEL_MAP: Record<number, string> = { 0: 'log', 1: 'info', 2: 'warn', 3: 'error' };

  function handleConsoleMessage(e: Event & { level?: number; message?: string; line?: number; sourceId?: string }) {
    const msg = e.message || '';

    // Handle selection messages from injected script
    if (msg.startsWith('__AIME_SELECTION__:')) {
      try {
        const payload = JSON.parse(msg.slice('__AIME_SELECTION__:'.length));
        setSelectionInfo({ text: payload.text, x: payload.x, y: payload.bottom + 4 });
      } catch { /* ignore parse errors */ }
      return;
    }
    if (msg === '__QUARRY_SELECTION_CLEAR__') {
      setSelectionInfo(null);
      return;
    }

    const level = CONSOLE_LEVEL_MAP[e.level ?? 0] || 'log';
    consoleBufferRef.current.push(level, msg, e.line ?? 0, e.sourceId || '');
  }

  function handleInjectSelectionListener() {
    const wv = webviewNodeRef.current;
    if (wv) {
      setSelectionInfo(null);
      wv.executeJavaScript(getSelectionListenerScript()).catch(() => {});
    }
  }

  const webviewCallbackRef = useCallback(
    (node: (HTMLElement & WebviewRef) | null) => {
      const prev = webviewNodeRef.current;
      if (prev) {
        prev.removeEventListener("did-navigate", handleNav);
        prev.removeEventListener("did-navigate-in-page", handleNav);
        prev.removeEventListener("page-title-updated", handleTitle);
        prev.removeEventListener("console-message", handleConsoleMessage as EventListener);
        prev.removeEventListener("did-finish-load", handleInjectSelectionListener);
        prev.removeEventListener("did-navigate", handleInjectSelectionListener);
      }
      webviewNodeRef.current = node;
      if (node) {
        node.addEventListener("did-navigate", handleNav);
        node.addEventListener("did-navigate-in-page", handleNav);
        node.addEventListener("page-title-updated", handleTitle);
        node.addEventListener("console-message", handleConsoleMessage as EventListener);
        node.addEventListener("did-finish-load", handleInjectSelectionListener);
        node.addEventListener("did-navigate", handleInjectSelectionListener);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function handleNav(e: Event & { url?: string }) {
    if (!e.url) return;
    setUrlInput(e.url);
    // Update store for persistence/display, but NOT webviewSrc.
    // This breaks the circular: store update → src change → re-navigate → ERR_ABORTED
    const state = useBrowserStore.getState();
    const cid = state.currentChatId;
    const tabId = cid ? state.activeTabIds[cid] : null;
    if (tabId) state.updateTabUrl(tabId, e.url);
  }

  function handleTitle(e: Event & { title?: string }) {
    if (!e.title) return;
    const state = useBrowserStore.getState();
    const cid = state.currentChatId;
    const tabId = cid ? state.activeTabIds[cid] : null;
    if (tabId) state.updateTabTitle(tabId, e.title);
  }

  // Ensure at least one tab exists (only after hydration to avoid overwriting persisted tabs)
  useEffect(() => {
    if (!hydrated || !chatId) return;
    if (tabs.length === 0) {
      addTab({ id: crypto.randomUUID(), url: "", title: "New Tab", isActive: true });
    }
  }, [hydrated, chatId, tabs.length, addTab]);

  // Sync conversation
  useEffect(() => {
    if (!activeConvId) return;
    const conv = allConversations.find((c) => c.id === activeConvId);
    if (conv?.surface === "browser") setCurrentChat(activeConvId);
  }, [activeConvId, allConversations, setCurrentChat]);

  // Sync webviewSrc when switching tabs (not on every URL update from did-navigate)
  useEffect(() => {
    if (activeTabId && activeTabId !== prevActiveTabIdRef.current) {
      prevActiveTabIdRef.current = activeTabId;
      const url = activeTab?.url || "";
      setWebviewSrc(url);
      setUrlInput(url);
    }
  }, [activeTabId, activeTab?.url]);

  // ── Inspector polling ─────────────────────────────────────────────────
  useEffect(() => {
    if (inspectorMode) {
      const wv = webviewNodeRef.current;
      if (!wv) return;

      wv.executeJavaScript(getInspectorInjectionScript()).catch(() => {});

      inspectorPollRef.current = setInterval(async () => {
        try {
          const result = await wv.executeJavaScript(getInspectorPollScript());
          if (result) {
            const inspectorResult = result as InspectorResult;
            addPendingContext({
              id: crypto.randomUUID(),
              type: "element",
              label: `<${inspectorResult.tag}> "${inspectorResult.text?.substring(0, 30) || ""}"`,
              content: formatElementContext(inspectorResult),
              timestamp: Date.now(),
            });
            setInspectorMode(false);
          }
        } catch {
          // webview not ready
        }
      }, 200);

      return () => {
        if (inspectorPollRef.current) clearInterval(inspectorPollRef.current);
        wv.executeJavaScript(getInspectorCleanupScript()).catch(() => {});
      };
    } else {
      if (inspectorPollRef.current) {
        clearInterval(inspectorPollRef.current);
        inspectorPollRef.current = null;
      }
    }
  }, [inspectorMode, addPendingContext, setInspectorMode]);

  // ── Keyboard shortcut: Cmd+Shift+S for screenshot ─────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "S") {
        e.preventDefault();
        handleScreenshot();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retrieve relevant memories for browser agent
  const memories = useMemoryStore((s) => s.memories);
  const memoriesStr = useMemo(() => {
    const active = memories.filter((m) => !m.supersededBy).slice(0, 20);
    return formatMemoriesForPrompt(active);
  }, [memories]);

  // ── Browser agent hook ──────────────────────────────────────────────────
  const handleSwitchTab = useCallback(async (tabId: string): Promise<(HTMLElement & import("@/lib/browser-tools").WebviewRef) | null> => {
    const state = useBrowserStore.getState();
    const cid = state.currentChatId;
    if (!cid) return null;

    const storeTabs = state.tabSessions[cid] ?? [];
    const targetTab = storeTabs.find((t) => t.id === tabId);
    if (!targetTab) return null;

    // Switch the active tab in the store
    state.setActiveTab(tabId, cid);

    const url = targetTab.url || "";
    setUrlInput(url);

    const wv = webviewNodeRef.current;
    if (wv && url) {
      // Navigate the webview directly (don't rely on React state re-render)
      try {
        await wv.loadURL(url);
      } catch (e) {
        // ERR_ABORTED from redirects is fine
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('(-3)') && !msg.includes('ERR_ABORTED')) {
          return null;
        }
      }
      // Also sync React state for UI consistency
      setWebviewSrc(url);
      // Small extra wait for page scripts to settle
      await new Promise((r) => setTimeout(r, 500));
    } else {
      // Empty URL tab — show landing page
      setWebviewSrc("");
    }

    return webviewNodeRef.current;
  }, []);

  const { runAgentLoop, abort } = useBrowserAgent({
    onText(text) {
      const id = useBrowserStore.getState().currentChatId ?? "";
      appendToLastAssistant(id, text);
    },
    onToolUse(id, name, input) {
      const cid = useBrowserStore.getState().currentChatId ?? "";
      addToolCall(cid, {
        id,
        name,
        input,
        status: "running",
        startTime: Date.now(),
      });
    },
    onToolResult(id, result, isError) {
      const cid = useBrowserStore.getState().currentChatId ?? "";
      updateToolResult(cid, id, result, isError);
    },
    onDone() {
      const cid = useBrowserStore.getState().currentChatId ?? "";
      stopStreaming(cid);
    },
    onError(error) {
      const cid = useBrowserStore.getState().currentChatId ?? "";
      stopStreaming(cid);
      appendToLastAssistant(cid, `\n\n**Error:** ${error.message}`);
    },
    onPhaseChange(phase) {
      setLoopPhase(phase);
    },
    apiKey: anthropicApiKey,
    memories: memoriesStr || undefined,
    consoleBuffer: consoleBufferRef.current,
    getTabs() {
      const state = useBrowserStore.getState();
      const cid = state.currentChatId;
      if (!cid) return [];
      return (state.tabSessions[cid] ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        isActive: t.id === state.activeTabIds[cid],
      }));
    },
    onSwitchTab: handleSwitchTab,
  });

  // Ensure a browser conversation exists for tab management.
  // Returns the chatId (creating one if needed).
  const ensureBrowserConversation = useCallback((): string => {
    let cid = useBrowserStore.getState().currentChatId;
    if (!cid) {
      cid = crypto.randomUUID();
      addConversation({
        id: cid,
        title: "Browser",
        surface: "browser",
        lastMessage: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setActiveConversation(cid);
      setCurrentChat(cid);
    }
    return cid;
  }, [addConversation, setActiveConversation, setCurrentChat]);

  const handleNavigate = useCallback(
    (url: string) => {
      const normalized = normalizeUrl(url);
      if (!normalized) return;
      // Ensure conversation exists so addTab/updateTabUrl don't bail
      ensureBrowserConversation();
      if (activeTabId) {
        updateTabUrl(activeTabId, normalized);
      } else {
        addTab({
          id: crypto.randomUUID(),
          url: normalized,
          title: "New Tab",
          isActive: true,
        });
      }
      setUrlInput(normalized);
      setWebviewSrc(normalized); // Intentional navigation — update the webview src
      // Track URL as project artifact
      if (currentProjectId && normalized) {
        try {
          const urlHost = new URL(normalized).hostname;
          useProjectStore.getState().addArtifact(currentProjectId, {
            id: crypto.randomUUID(),
            name: urlHost,
            path: normalized,
            type: "url",
            surface: "browser",
            conversationId: chatId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          useProjectStore.getState().addProjectUrl(currentProjectId, normalized);
        } catch {
          // Invalid URL, skip
        }
      }
    },
    [activeTabId, updateTabUrl, addTab, currentProjectId, chatId, ensureBrowserConversation]
  );

  // ── Interaction handlers ──────────────────────────────────────────────
  const handleToggleInspector = useCallback(() => {
    const wv = webviewNodeRef.current;
    if (!wv) return;
    const next = !useBrowserStore.getState().inspectorMode;
    if (!next) {
      wv.executeJavaScript(getInspectorCleanupScript()).catch(() => {});
    }
    setInspectorMode(next);
  }, [setInspectorMode]);

  const handleGrabSelection = useCallback(async () => {
    const wv = webviewNodeRef.current;
    if (!wv) return;
    try {
      const text = (await wv.executeJavaScript(getSelectionScript())) as string;
      if (text?.trim()) {
        addPendingContext({
          id: crypto.randomUUID(),
          type: "selection",
          label: `"${text.trim().substring(0, 40)}${text.trim().length > 40 ? "..." : ""}"`,
          content: text.trim(),
          timestamp: Date.now(),
        });
      }
    } catch {
      // no selection
    }
  }, [addPendingContext]);

  const handleScreenshot = useCallback(async () => {
    const wv = webviewNodeRef.current;
    if (!wv) return;
    try {
      const dataUrl = await captureScreenshot(wv);
      addPendingContext({
        id: crypto.randomUUID(),
        type: "screenshot",
        label: "Screenshot",
        preview: dataUrl,
        content: dataUrl,
        timestamp: Date.now(),
      });
    } catch {
      // capture failed
    }
  }, [addPendingContext]);

  const handleSendSelection = useCallback(() => {
    if (!selectionInfo) return;
    const text = selectionInfo.text.trim();
    addPendingContext({
      id: crypto.randomUUID(),
      type: "selection",
      label: `"${text.substring(0, 40)}${text.length > 40 ? "..." : ""}"`,
      content: text,
      timestamp: Date.now(),
    });
    setSelectionInfo(null);
    const wv = webviewNodeRef.current;
    if (wv) {
      wv.executeJavaScript("window.getSelection().removeAllRanges()").catch(() => {});
    }
  }, [selectionInfo, addPendingContext]);

  // ── Agent submit (with conversation creation fix) ─────────────────────
  const handleAgentSubmit = useCallback(
    async (text: string) => {
      // ── Slash command interception ─────────────────────────────────────
      const parsed = parseSlashCommand(text);
      if (parsed) {
        const result = applySlashCommand(parsed, sessionControls);
        if (result) {
          setSessionControls(result.controls);
          const id = ensureBrowserConversation();
          addMessage(id, { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now() });
          addMessage(id, { id: crypto.randomUUID(), role: 'assistant', content: result.message, timestamp: Date.now() });
          setInputValue('');
          return;
        }
      }

      // Ensure conversation exists (reuse shared helper)
      const id = ensureBrowserConversation();

      addMessage(id, {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
        attachments: attachments.length > 0 ? attachments.map(a => ({ name: a.name, content: '', type: a.type, category: a.category as 'image' | 'document' | 'text' })) : undefined,
      });
      updateConversation(id, {
        title: text.substring(0, 50),
        lastMessage: text,
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

      // Capture and clear pending context + attachments
      const context: PendingContextItem[] = [...useBrowserStore.getState().pendingContext];
      clearPendingContext();

      // Convert attachments to pending context items
      const currentAttachments = [...attachments];
      setAttachments([]);
      const pushAtt = (
        type: PendingContextItem['type'],
        name: string,
        content: string,
      ) => {
        context.push({
          id: crypto.randomUUID(),
          type,
          label: name,
          content,
          timestamp: Date.now(),
        });
      };
      for (const att of currentAttachments) {
        if (att.category === 'image' && att.content) {
          pushAtt('screenshot', att.name, att.content);
        } else if (att.category === 'text' && att.content) {
          pushAtt('document', att.name, `<document name="${att.name}">\n${att.content}\n</document>`);
        } else if (att.content) {
          // Binary files (PDF, DOCX): try decoding as text, otherwise note it's binary
          try {
            const decoded = atob(att.content);
            const isText = decoded.length > 0 && /^[\x20-\x7E\t\n\r]*$/.test(decoded.substring(0, 200));
            if (isText) {
              pushAtt('document', att.name, `<document name="${att.name}">\n${decoded}\n</document>`);
            } else {
              pushAtt('document', att.name, `[Attached file: ${att.name} (${att.category}). This is a binary file — for full document analysis, use the Cowork or Chat surface which can extract text from PDFs and documents.]`);
            }
          } catch {
            pushAtt('document', att.name, `[Attached file: ${att.name}]`);
          }
        }
      }

      // Check API key is available before making the request
      const currentApiKey = useSettingsStore.getState().anthropicApiKey;
      if (!currentApiKey) {
        appendToLastAssistant(id, "No API key configured. Go to Settings > Connectors and add your nib AI Studio Gateway key.");
        stopStreaming(id);
        return;
      }

      const wv = webviewNodeRef.current;
      if (!wv) {
        appendToLastAssistant(id, "No webview available. Navigate to a page first.");
        stopStreaming(id);
        return;
      }

      await runAgentLoop(text, model, wv, context.length > 0 ? context : undefined);
    },
    [model, addMessage, startStreaming, runAgentLoop, updateConversation, appendToLastAssistant, stopStreaming, ensureBrowserConversation, clearPendingContext, attachments]
  );

  const handleVoiceTranscript = useCallback(
    (text: string) => setInputValue((prev) => (prev ? `${prev} ${text}` : text)),
    []
  );

  // Resize handle
  const handleMouseDown = useCallback(() => {
    resizingRef.current = true;
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(250, Math.min(600, newWidth)));
    };
    const handleMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  const phaseInfo = PHASE_LABELS[loopPhase];

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-surface shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors max-w-[150px] ${
              tab.id === activeTabId
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">{tab.title || "New Tab"}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  removeTab(tab.id);
                }
              }}
              className="shrink-0 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            ensureBrowserConversation();
            addTab({
              id: crypto.randomUUID(),
              url: "",
              title: "New Tab",
              isActive: true,
            });
          }}
        >
          <Plus className="h-3 w-3" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setAgentVisible(!agentVisible)}
        >
          {agentVisible ? (
            <PanelRightClose className="h-3.5 w-3.5" />
          ) : (
            <PanelRight className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => webviewNodeRef.current?.goBack()}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => webviewNodeRef.current?.goForward()}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => webviewNodeRef.current?.reload()}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>

        {/* Divider */}
        <div className="w-px h-4 bg-border mx-0.5" />

        {/* Inspector toggle */}
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${inspectorMode ? "text-blue-500 bg-blue-500/10" : ""}`}
          onClick={handleToggleInspector}
          title="Inspect element"
        >
          <Crosshair className="h-3.5 w-3.5" />
        </Button>

        {/* Grab selection */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleGrabSelection}
          title="Grab selected text"
        >
          <Type className="h-3.5 w-3.5" />
        </Button>

        {/* Screenshot */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleScreenshot}
          title="Take screenshot (Cmd+Shift+S)"
        >
          <Camera className="h-3.5 w-3.5" />
        </Button>

        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleNavigate(urlInput);
          }}
          placeholder="Enter URL or search..."
          className="h-7 text-xs flex-1 bg-card"
        />
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Browser webview */}
        <div className={`flex-1 bg-white relative ${inspectorMode ? "ring-2 ring-blue-500 ring-inset" : ""}`}>
          {webviewSrc ? (
            <webview
              ref={webviewCallbackRef as unknown as React.RefObject<never>}
              src={webviewSrc}
              partition="persist:browser"
              useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
              allowpopups={"true" as unknown as boolean}
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-muted">
              <div className="text-center space-y-5">
                <img
                  src="/mascot.svg"
                  alt="Mascot"
                  width={64}
                  height={64}
                  className="mx-auto mascot-jiggle"
                />
                <p className="text-lg font-light text-muted-foreground">
                  Where to?
                </p>
                <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
                  {[
                    { name: "Google", url: "https://www.google.com", logo: "https://www.google.com/favicon.ico" },
                    { name: "GitHub", url: "https://github.com", logo: "https://github.githubassets.com/favicons/favicon-dark.svg" },
                    { name: "Miro", url: "https://miro.com", logo: "https://miro.com/favicon.ico" },
                    { name: "Confluence", url: "https://confluence.atlassian.com", logo: "https://www.google.com/s2/favicons?domain=confluence.atlassian.com&sz=64" },
                    { name: "Jira", url: "https://jira.atlassian.com", logo: "https://www.google.com/s2/favicons?domain=jira.atlassian.com&sz=64" },
                    { name: "SharePoint", url: "https://sharepoint.com", logo: "https://www.google.com/s2/favicons?domain=sharepoint.com&sz=64" },
                  ].map((site) => (
                    <button
                      key={site.name}
                      onClick={() => handleNavigate(site.url)}
                      className="flex flex-col items-center gap-2 rounded-xl p-3 hover:bg-background/60 transition-colors group"
                    >
                      <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-background/40 shadow-sm group-hover:scale-110 transition-transform">
                        <img
                          src={site.logo}
                          alt={site.name}
                          width={24}
                          height={24}
                          className="object-contain"
                        />
                      </div>
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                        {site.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* Inspector mode floating label */}
          {inspectorMode && (
            <div className="absolute top-2 left-2 bg-blue-500 text-white text-xs px-2 py-1 rounded shadow-lg pointer-events-none z-10">
              Inspector — click to capture, ESC to cancel
            </div>
          )}
          {/* Floating "Send to Chat" button on text selection */}
          {selectionInfo && (
            <div
              className="absolute z-20"
              style={{ left: selectionInfo.x, top: selectionInfo.y }}
            >
              <Button
                size="sm"
                className="h-7 text-xs shadow-lg"
                onClick={handleSendSelection}
              >
                <MessageSquare className="h-3 w-3 mr-1" />
                Send to Chat
              </Button>
            </div>
          )}
        </div>

        {/* Resize handle */}
        {agentVisible && (
          <div
            onMouseDown={handleMouseDown}
            className="w-1 cursor-col-resize bg-border hover:bg-primary/50 transition-colors flex items-center justify-center"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        )}

        {/* Agent sidebar */}
        {agentVisible && (
          <div
            className="flex flex-col bg-surface border-l border-border shrink-0"
            style={{ width: panelWidth }}
          >
            <div className="px-3 py-2 border-b border-border flex items-center gap-2">
              <span className="text-xs font-semibold">Agent</span>
              {phaseInfo && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground animate-pulse">
                  <phaseInfo.icon className="h-3 w-3" />
                  {phaseInfo.text}
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col min-h-0">
              {/* Continue in Surface handoff (when project is active) */}
              {currentProjectId && !isStreaming && messages.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50">
                  <span className="text-xs text-muted-foreground">Continue in:</span>
                  <ContinueInSurface
                    currentSurface="browser"
                    projectId={currentProjectId}
                    conversationId={chatId}
                  />
                </div>
              )}
              <MessageList messages={messages} className="text-xs" conversationId={chatId} />

              {/* Pending context display */}
              {pendingContext.length > 0 && (
                <div className="px-3 py-2 border-t border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-medium">Context</span>
                    <button
                      onClick={clearPendingContext}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pendingContext.map((item) => (
                      <div
                        key={item.id}
                        className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
                      >
                        {item.type === "screenshot" && item.preview ? (
                          <img
                            src={item.preview}
                            alt="Screenshot"
                            className="h-6 w-10 rounded object-cover"
                          />
                        ) : item.type === "element" ? (
                          <Crosshair className="h-3 w-3 text-blue-500 shrink-0" />
                        ) : (
                          <Type className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate max-w-[120px]">{item.label}</span>
                        <button
                          onClick={() => removePendingContext(item.id)}
                          className="hover:text-destructive shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="px-4 pt-3">
                  <div className="max-w-3xl mx-auto">
                    <CommandPicker
                      suggestions={slashSuggestions}
                      selectedIndex={selectedSuggestionIdx}
                      onSelect={(s) => {
                        setInputValue(s.value + ' ');
                        setSlashSuggestions([]);
                        setSelectedSuggestionIdx(0);
                      }}
                      onSelectedIndexChange={setSelectedSuggestionIdx}
                    />
                  </div>
                </div>
                <InputArea
                  value={inputValue}
                  onChange={(val) => {
                    setInputValue(val);
                    setSlashSuggestions(
                      getSlashSuggestions(val).map((cmd) => ({
                        type: 'slash' as const,
                        value: cmd.name,
                        label: cmd.name,
                        description: cmd.args,
                        meta: cmd.description,
                      }))
                    );
                    setSelectedSuggestionIdx(0);
                  }}
                  onSubmit={handleAgentSubmit}
                  onAbort={abort}
                  isStreaming={isStreaming}
                  placeholder="Ask about this page..."
                  attachments={attachments}
                  onRemoveAttachment={(i) => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  extraControls={
                    <>
                      <AttachmentMenu
                        onFileSelect={(file) => setAttachments((prev) => [...prev, file])}
                        onWebSearchToggle={() => {}}
                        webSearchEnabled={false}
                        hideWebSearch
                        currentProjectId={currentProjectId}
                        onAddToProject={(pid) => assignToProject(chatId, pid)}
                        onNewProject={() => setSidebarMode("projects")}
                        projects={allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
                      />
                      <VoiceButton onTranscript={handleVoiceTranscript} />
                    </>
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
