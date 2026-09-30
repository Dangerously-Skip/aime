"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { MessageList } from "@/components/shared/message-list";
import { Composer } from "@/components/shared/composer/composer";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { useBrowserStore } from "@/stores/browser-store";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useBrowserAgent } from "@/hooks/use-browser-agent";
import { useMemoryStore } from "@/stores/memory-store";
import { formatMemoriesForPrompt } from "@/lib/memory/retriever";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useProjectContext } from "@/hooks/use-project-context";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
import { useHydrated } from "@/components/store-hydration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConsoleLogBuffer, type WebviewRef } from "@/lib/browser-tools";
import { useScratchDir } from "@/hooks/use-scratch-dir";
import { StreamTurnError } from "@/hooks/use-sse-stream";
import { handleBrowserToolChunk } from "@/lib/sse/browser-tool-chunk";
import { classifyBrowserRequest } from "@/lib/browser/request-shape";
import { useSurfaceKeydown } from "@/hooks/use-surface-active";
import { useSurfaceTurn } from "@/hooks/use-surface-turn";
import { useTurnSettings } from "@/hooks/use-turn-settings";
import { APP_NAME } from "@/config/branding";
import { useWebviewLoadState, LoadProgressBar, LoadErrorOverlay } from "./page-status";
import { AgentControlBanner } from "./agent-control-banner";

/** Same source of truth the other surfaces use for their capability. */
const CAPABILITY = getSurfaceRoute("browser").capability;
import {
  getInspectorInjectionScript,
  getInspectorCleanupScript,
  getInspectorPollScript,
  getSelectionScript,
  getSelectionListenerScript,
  captureScreenshot,
  isSelectionClearMessage,
  formatElementContext,
  type InspectorResult,
  type PendingContextItem,
} from "@/lib/browser-interactions";
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

const EMPTY_TABS: import("@/stores/browser-store").BrowserTab[] = [];

/** Which of the two loops is running a conversation's turn — see `dispatch`. */
type BrowserLoop = "quick-ask" | "agent";

/**
 * An attachment as page context. The agent takes history rather than a
 * context array, so everything becomes a `PendingContextItem`.
 */
function attachmentAsContext(att: AttachmentFile): PendingContextItem | null {
  const item = (type: PendingContextItem["type"], content: string): PendingContextItem => ({
    id: crypto.randomUUID(),
    type,
    label: att.name,
    content,
    timestamp: Date.now(),
  });
  if (!att.content) return null;
  if (att.category === "image") return item("screenshot", att.content);
  if (att.category === "text") return item("document", `<document name="${att.name}">\n${att.content}\n</document>`);
  // Binary files (PDF, DOCX): try decoding as text, otherwise say it is binary.
  try {
    const decoded = atob(att.content);
    if (decoded.length > 0 && /^[\x20-\x7E\t\n\r]*$/.test(decoded.substring(0, 200))) {
      return item("document", `<document name="${att.name}">\n${decoded}\n</document>`);
    }
    return item(
      "document",
      `[Attached file: ${att.name} (${att.category}). This is a binary file — for full document analysis, use the Cowork or Chat surface which can extract text from PDFs and documents.]`,
    );
  } catch {
    return item("document", `[Attached file: ${att.name}]`);
  }
}

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
  const [urlInput, setUrlInput] = useState("");
  const [agentVisible, setAgentVisible] = useState(true);
  const [panelWidth, setPanelWidth] = useState(350);
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
  /*
   * Somewhere for the agent to write. Browser has no folder picker, so this is
   * the only writable location it has — see the `cwd` note in `request`.
   */
  const scratchDir = useScratchDir(chatId);
  const loopPhase = useBrowserStore((s) => s.loopPhase);
  const appendToLastAssistant = useBrowserStore((s) => s.appendToLastAssistant);
  const addToolCall = useBrowserStore((s) => s.addToolCall);
  const updateToolResult = useBrowserStore((s) => s.updateToolResult);
  const setLoopPhase = useBrowserStore((s) => s.setLoopPhase);
  const inspectorMode = useBrowserStore((s) => s.inspectorMode);
  const setInspectorMode = useBrowserStore((s) => s.setInspectorMode);
  const pendingContext = useBrowserStore((s) => s.pendingContext);
  const addPendingContext = useBrowserStore((s) => s.addPendingContext);
  const removePendingContext = useBrowserStore((s) => s.removePendingContext);
  const clearPendingContext = useBrowserStore((s) => s.clearPendingContext);

  const { projectId: currentProjectId, projectInstructions, projectKnowledge, crossSurfaceContext } = useProjectContext(chatId, "browser");
  const settings = useTurnSettings(chatId, { projectInstructions, projectKnowledge, crossSurfaceContext });
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
    if (isSelectionClearMessage(msg)) {
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

  // Progress bar + error overlay, from the webview's own load events.
  const pageLoad = useWebviewLoadState();
  const attachLoadState = pageLoad.attach;

  const webviewCallbackRef = useCallback(
    (node: (HTMLElement & WebviewRef) | null) => {
      attachLoadState(node);
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
  // Only while Browser is on screen: every surface stays mounted, and this
  // used to capture the page from Code or Chat. Lower-cased because macOS
  // reports `s` rather than `S` for ⌘⇧S.
  useSurfaceKeydown((e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void handleScreenshot();
    }
  });

  // Retrieve relevant memories for browser agent
  const memories = useMemoryStore((s) => s.memories);
  const memoriesStr = useMemo(() => {
    const active = memories.filter((m) => !m.supersededBy).slice(0, 20);
    return formatMemoriesForPrompt(active);
  }, [memories]);

  // ── Browser agent hook ──────────────────────────────────────────────────
  /**
   * Open a URL in a BACKGROUND tab and report its index.
   *
   * Background is the point: the asking task is "open these several so I can
   * look at them", and stealing focus per tab would leave the agent observing a
   * page other than the one it is reasoning about — which is the drift that
   * produced the failure this tool exists to fix.
   */
  const handleNewTab = useCallback(async (url: string): Promise<number | null> => {
    /*
     * Reads currentChatId rather than calling ensureBrowserConversation, which
     * is declared further down the file. The agent only runs while a browser
     * conversation exists, so the null branch is a genuine "cannot" rather than
     * a case worth manufacturing state for.
     */
    const cid = useBrowserStore.getState().currentChatId;
    if (!cid) return null;
    const id = crypto.randomUUID();
    addTab({ id, url, title: url, isActive: false }, cid);
    const tabs = useBrowserStore.getState().tabSessions[cid] ?? [];
    const index = tabs.findIndex((t) => t.id === id);
    return index >= 0 ? index : null;
  }, [addTab]);

  const handleCloseTab = useCallback(async (tabId: string): Promise<boolean> => {
    const state = useBrowserStore.getState();
    const cid = state.currentChatId;
    if (!cid) return false;
    const before = (state.tabSessions[cid] ?? []).length;
    state.removeTab(tabId, cid);
    return (useBrowserStore.getState().tabSessions[cid] ?? []).length < before;
  }, []);

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

  /*
   * Which loop is running each conversation's turn, so Stop stops the right one.
   *
   * The two paths have separate abort mechanisms — the local loop owns an
   * AbortController, the SSE stream is keyed in a registry — and calling the
   * wrong one leaves a turn running with the composer unlocked.
   */
  const loopsRef = useRef<Map<string, BrowserLoop>>(new Map());
  /**
   * Quick-ask runs already settled — failed, or stopped by the user — so the
   * loop's `onDone`, which runs however it ended, does not also record a success.
   */
  const settledRef = useRef<Set<string>>(new Set());

  /*
   * Whether the agent is DRIVING THE PAGE right now, which is narrower than
   * "a turn is running": the full agent may spend a whole turn on WebFetch and
   * never touch this page. Quick-ask always drives it; the agent path counts
   * from its first browser tool. Drives the "controlling this page" banner.
   */
  const [agentControl, setAgentControl] = useState<BrowserLoop | null>(null);
  /** Steps taken when the quick-ask loop hit its limit and is waiting on the user. */
  const [stepLimit, setStepLimit] = useState<number | null>(null);
  const stepLimitResolveRef = useRef<((more: boolean) => void) | null>(null);
  const answerStepLimit = useCallback((more: boolean) => {
    stepLimitResolveRef.current?.(more);
    stepLimitResolveRef.current = null;
    setStepLimit(null);
  }, []);

  /** A turn on either loop is over: nothing drives the page any more. */
  const loopEnded = useCallback((cid: string) => {
    loopsRef.current.delete(cid);
    setLoopPhase('idle');
    setAgentControl(null);
  }, [setLoopPhase]);

  /*
   * The full agent, on the same path as every other surface — and the same
   * turn: route, run record, typed errors, Retry, per-chat streaming.
   *
   * WHY IT EXISTS. This surface used to have exactly one loop: a hand-rolled
   * ReAct loop against the raw Messages API with browser tools and nothing
   * else. So the surface whose entire purpose is agentic browsing ran the LEAST
   * capable agent in the app — no MCP, no connectors, no canvas, no memory, no
   * subagents, no skills (DR-22).
   */
  const turn = useSurfaceTurn({
    surface: "browser",
    label: "Browser",
    store: useBrowserStore,
    capability: CAPABILITY,
    // No picker and no stored model: Settings (tier grid + providers) decides,
    // through the same `resolveSendRoute` every surface uses.
    modelRoute: null,
    /*
     * Browser cannot DISPLAY a canvas. The canvas store, its overlay and its
     * dispatch are keyed to chat/cowork/code, and widening them is a separate
     * decision. So the absence is stated rather than silent — a dropped canvas
     * is this codebase's signature bug: wired, produces nothing, and no way to
     * tell whether the agent tried. "Continue in Cowork" is right here.
     */
    onCanvas: (event, cid) => {
      const title = (event.doc as { title?: string } | undefined)?.title;
      appendToLastAssistant(
        cid,
        `\n\n_Built a canvas${title ? ` — “${title}”` : ''}, which the Browser surface cannot display. Continue this conversation in Cowork to see it._\n`,
      );
    },
    request: () => ({
      ...settings,
      /*
       * A PLACE TO WRITE. Browser has Write and Edit auto-approved and a prompt
       * telling it to accumulate findings in a file — with no `cwd`, those land
       * in the SERVER PROCESS's working directory. The scratch dir is the honest
       * home for it: per-conversation, and the same fallback Cowork uses.
       */
      cwd: scratchDir || undefined,
      /*
       * Only when a webview can actually serve them. Offering `navigate` with
       * nothing to navigate is DR-21's loop one layer down: the agent cannot
       * discover that a step is impossible, so it repeats it until the turn dies.
       */
      browserToolsAvailable: !!webviewNodeRef.current,
      memories: memoriesStr || undefined,
    }),
    /*
     * TWO LOOPS, SPLIT BY THE SHAPE OF THE REQUEST — not by a toggle the user
     * has to find (DR-22 D-1). A question about what is on screen stays local:
     * browser tools only, sub-second. Anything goal-shaped goes to the full
     * agent. The default is the full agent, because a page question routed
     * there costs a few seconds while a goal routed to the quick loop fails the
     * whole task silently.
     */
    dispatch: async (prepared, send) => {
      const { chatId: cid, text, attachments, route, sessionControls } = prepared;
      // Selections, screenshots, inspected elements and attachments are all
      // context — the thing the user pointed at is most of why they asked.
      const context: PendingContextItem[] = [...useBrowserStore.getState().pendingContext];
      clearPendingContext();
      for (const att of attachments) {
        const item = attachmentAsContext(att);
        if (item) context.push(item);
      }
      // `/model` pins a model for the session on top of Settings.
      const model = sessionControls.modelOverride ?? route?.model ?? null;

      if (classifyBrowserRequest(text) === 'quick-ask') {
        const wv = webviewNodeRef.current;
        if (!wv) {
          turn.failTurn(cid, new StreamTurnError('unknown', 'No page is open to ask about. Navigate to a page first.'));
          return;
        }
        loopsRef.current.set(cid, 'quick-ask');
        setAgentControl('quick-ask');
        await runAgentLoop(text, { model, providerConfig: route?.providerConfig }, wv, context.length > 0 ? context : undefined, cid);
        return;
      }

      loopsRef.current.set(cid, 'agent');
      setLoopPhase('thinking');
      // The full agent takes history rather than a context array, so the
      // context travels as text ahead of the question.
      const contextPrefix = context.length > 0
        ? context.map((c) => `<context type="${c.type}" label="${c.label}">\n${c.content}\n</context>`).join('\n') + '\n\n'
        : '';
      await send({ message: contextPrefix + text, model, extra: { attachments: undefined } });
    },
    chunks: {
      /*
       * The browser-tool relay: the server pauses the turn, we execute against
       * the live webview and POST the result back. This surface HAS tabs, and
       * they are not webview operations, so the agent needs the same three tab
       * callbacks the quick loop has — or `new_tab` is an unknown tool and the
       * agent loops on it (DR-21: twenty-two calls in one run).
       */
      before: (event, cid) => {
        const handled = handleBrowserToolChunk(event, {
          chatId: cid,
          webview: webviewNodeRef.current,
          consoleBuffer: consoleBufferRef.current,
          addToolCall,
          updateToolResult,
          noWebviewMessage:
            'No browser view is available. Navigate to a page first, or use WebFetch to read a URL you are not looking at.',
          surface: 'BrowserSurface',
          tabs: {
            open: handleNewTab,
            switch: handleSwitchTab,
            close: handleCloseTab,
            // The SAME order the model was shown, read fresh on each call so a
            // tab opened mid-turn is reachable.
            list: () => useBrowserStore.getState().getTabsForChat(cid).map((t) => ({ id: t.id })),
          },
        });
        // The agent has started driving the page: say so on the page.
        if (handled) setAgentControl('agent');
        return handled;
      },
    },
    onDone: (cid) => loopEnded(cid),
    onError: (_error, cid) => loopEnded(cid),
  });
  const { messages, isStreaming } = turn;

  const { runAgentLoop, abort: abortQuickAsk } = useBrowserAgent({
    // Every callback is handed the chat the run was started for.
    onText: (text, cid) => appendToLastAssistant(cid, text),
    onToolUse: (id, name, input, cid) =>
      addToolCall(cid, { id, name, input, status: "running", startTime: Date.now() }),
    onToolResult: (id, result, isError, cid) => updateToolResult(cid, id, result, isError),
    onError: (error, cid) => {
      settledRef.current.add(cid);
      turn.failTurn(cid, error);
    },
    onDone: (cid) => {
      if (settledRef.current.delete(cid)) return;
      turn.completeTurn(cid);
    },
    onPhaseChange: setLoopPhase,
    // At the step limit, ask on the banner rather than stopping silently.
    onStepLimit(steps) {
      return new Promise<boolean>((resolve) => {
        stepLimitResolveRef.current = resolve;
        setStepLimit(steps);
      });
    },
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
    onNewTab: handleNewTab,
    onCloseTab: handleCloseTab,
  });

  /**
   * Stop the conversation on screen, on whichever loop it is running.
   *
   * Two paths, two abort mechanisms. Calling the wrong one leaves the turn
   * running while the composer unlocks, which reads as Stop having done nothing.
   */
  const abort = useCallback(() => {
    const cid = useBrowserStore.getState().currentChatId ?? '';
    if (loopsRef.current.get(cid) === 'quick-ask') {
      // A Stop is a cancel, not the success the loop's `onDone` would record.
      settledRef.current.add(cid);
      turn.runRecorder.cancel(cid);
      abortQuickAsk();
      const store = useBrowserStore.getState();
      store.completeRunningTools(cid);
      store.stopStreaming(cid);
    } else {
      turn.abort();
    }
    loopEnded(cid);
    // A pending "continue?" is answered no, so the loop can finish unwinding.
    answerStepLimit(false);
  }, [turn, abortQuickAsk, loopEnded, answerStepLimit]);

  /** Stop the agent and hand the page back: focus lands in it, ready to use. */
  const takeOver = useCallback(() => {
    abort();
    const cid = useBrowserStore.getState().currentChatId;
    if (cid) appendToLastAssistant(cid, `\n\n_You took over — ${APP_NAME} stopped here._`);
    (webviewNodeRef.current as HTMLElement | null)?.focus?.();
  }, [abort, appendToLastAssistant]);

  // Tabs need a conversation to belong to; navigating creates one if needed.
  const ensureBrowserConversation = turn.ensureConversation;

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

  /** Load the failed URL again. `did-start-loading` clears the overlay. */
  const retryLoad = () => {
    const url = pageLoad.failure?.url || webviewSrc;
    pageLoad.clearFailure();
    const wv = webviewNodeRef.current;
    if (wv && url) wv.loadURL(url).catch(() => { /* did-fail-load reports it */ });
    else wv?.reload();
  };

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
              aria-label={`Close ${tab.title || "New Tab"}`}
              title="Close tab"
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
          aria-label="New tab"
          title="New tab"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setAgentVisible(!agentVisible)}
          aria-label={agentVisible ? "Hide agent panel" : "Show agent panel"}
          title={agentVisible ? "Hide agent panel" : "Show agent panel"}
          aria-pressed={agentVisible}
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
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => webviewNodeRef.current?.goForward()}
          aria-label="Forward"
          title="Forward"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => webviewNodeRef.current?.reload()}
          aria-label="Reload"
          title="Reload"
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
          aria-label="Inspect element"
          aria-pressed={inspectorMode}
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
          aria-label="Grab selected text"
        >
          <Type className="h-3.5 w-3.5" />
        </Button>

        {/* Screenshot */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleScreenshot}
          title="Take screenshot (⌘⇧S)"
          aria-label="Take screenshot"
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
          aria-label="Address"
          className="h-7 text-xs flex-1 bg-card"
        />
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Browser webview */}
        <div className={`flex-1 bg-white relative ${inspectorMode ? "ring-2 ring-blue-500 ring-inset" : ""}`}>
          {/*
              ALWAYS MOUNTED, at about:blank until someone navigates.

              This used to render only once `webviewSrc` was set, i.e. only after
              a user had navigated. Which meant: no webview, so no browser tools,
              so AUTOMATION COULD NOT BROWSE AT ALL — a cron job or standing
              order firing against this surface found nothing to drive.

              That looked like it needed a headless browser host (DR-23). It does
              not. Every surface is mounted the whole time the app is running —
              `surface-router` hides inactive ones with CSS, and "a hidden
              surface still runs its effects" — and cron fires on the minute tick
              in this same renderer. So there is always a renderer with this
              surface in it; the only thing missing was the browser inside it.

              Same defect as the preview panel: a component that exists only once
              someone has already used it. The empty state is drawn OVER the
              webview rather than instead of it, so the mascot still greets a new
              user while the agent has something to hold.
          */}
          <webview
            ref={webviewCallbackRef as unknown as React.RefObject<never>}
            src={webviewSrc || 'about:blank'}
            partition="persist:browser"
            useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            allowpopups={"true" as unknown as boolean}
            style={{ width: "100%", height: "100%", border: "none" }}
          />
          {webviewSrc && pageLoad.loading && !pageLoad.failure && <LoadProgressBar />}
          {webviewSrc && pageLoad.failure && (
            <LoadErrorOverlay failure={pageLoad.failure} onRetry={retryLoad} />
          )}
          {agentControl && (
            <AgentControlBanner
              stepLimit={stepLimit}
              onStop={abort}
              onTakeOver={takeOver}
              onContinue={() => answerStepLimit(true)}
            />
          )}
          {!webviewSrc && (
            // `absolute inset-0` — drawn OVER the webview, which is now always
            // mounted underneath. Opaque, so about:blank never shows through.
            <div className="absolute inset-0 flex h-full items-center justify-center bg-muted">
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
            className="flex flex-col surface-well m-2 shrink-0"
            style={{ width: panelWidth }}
          >
            <div className="px-3 py-2 flex items-center gap-2">
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
              <MessageList {...turn.transcript} onCancel={chatId ? abort : undefined} className="text-xs" />

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
                          aria-label={`Remove ${item.label}`}
                          className="hover:text-destructive shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-3 pb-3 pt-2">
                <Composer
                  {...turn.composer}
                  onStop={abort}
                  placeholder="Ask about this page..."
                  attachmentMenu={{
                    hideWebSearch: true,
                    currentProjectId,
                    onAddToProject: (pid) => assignToProject(chatId, pid),
                    onNewProject: () => setSidebarMode("projects"),
                    projects: allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon })),
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
