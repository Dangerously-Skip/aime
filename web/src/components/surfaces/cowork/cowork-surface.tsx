"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MessageList } from "@/components/shared/message-list";
import { ModelSelector } from "@/components/shared/model-selector";
import { FolderPicker } from "@/components/shared/folder-picker";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { useCoworkStore } from "@/stores/cowork-store";
import { useConversationStore, isUntitled } from "@/stores/conversation-store";
import { useSearchSettings } from '@/hooks/use-search-settings'
import { useDeckTheme } from '@/hooks/use-deck-theme'
import { useSettingsStore } from "@/stores/settings-store";
import { useSSEStream, stripMessagesForHistory, turnErrorOf } from "@/hooks/use-sse-stream";
import { handleAgnosticChunk } from "@/lib/sse/agnostic-chunks";
import { handleCoreChunk } from "@/lib/sse/core-chunks";
import { parseSearchWebResults, isParsableSearchTool } from "@/lib/search/parse-results";
import { scheduleFromCronMarker } from "@/lib/sse/aime-cron";
import { streamRegistry } from "@/lib/stream-registry";
import { useProjectContext } from "@/hooks/use-project-context";
import { useMemoryStore } from "@/stores/memory-store";
import { formatMemoriesForPrompt } from "@/lib/memory/retriever";
import { summarizeConversation } from "@/lib/memory/summarizer";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { sendConversationCompletedEvent, sendFeatureAdoptionEvent } from "@/lib/telemetry/events";
import { useScratchDir } from "@/hooks/use-scratch-dir";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
import { useFileDrop } from "@/hooks/use-file-drop";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import type { Message } from "@/stores/chat-store";
import { FilePreviewSheet } from "@/components/shared/file-preview-sheet";
import { PlanSheet } from "@/components/shared/plan-sheet";
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  FileText,
  FilePen,
  X,
  PanelRightClose,
  PanelRight,
  FolderOpen,
  Globe,
  ListChecks,
  LayoutDashboard,
  Eye,
  EyeOff,
  Search,
  Zap,
  Terminal as TerminalIcon,
} from "lucide-react";
import { PreviewPanel } from "@/components/shared/preview-panel";
import {
  classifyContextEntry,
  contextEntryDisplayName,
  isOpenableEntry,
  isSearchEntry,
} from "@/lib/cowork/context-entry";
import { detectServerUrl } from "@/lib/artifacts/server-detector";
import type { ParsedArtifact } from "@/lib/artifacts/parser";
import { RailSlot } from "@/lib/panels/rail-slot";
import { railPanels } from "@/lib/panels/registry";
import {
  GoalModeToggle, GoalModeBar, goalSettingsFrom,
  DEFAULT_BUDGET_USD, DEFAULT_SESSION_CAP,
} from "@/components/harness/goal-mode";
import { useStartGoal } from "@/components/harness/use-start-goal";
import { useGoalTranscript } from "@/components/harness/use-goal-transcript";
import { GoalRunStatus } from "@/components/harness/goal-run-status";
import { GoalQuestion } from "@/components/harness/goal-question";
import { useElectron } from "@/hooks/use-electron";
import { EditorPicker } from "@/components/shared/editor-picker";
import { useCanvasStore } from "@/stores/canvas-store";
import { CanvasOverlay } from "@/components/shared/canvas-overlay";
import { useCanvasSseHandler } from "@/hooks/use-canvas-sse-handler";
import {
  BASH_ARTIFACT_EXT,
  isValidSidebarEntry,
  categorizeToolCall,
} from "@/lib/artifact-tracker";
import { Composer, type ComposerHandle } from "@/components/shared/composer/composer";
import { addComposerAttachment, draftKey, useComposerDrafts } from "@/components/shared/composer/draft-store";
import { lastUserPrompt } from "@/components/shared/composer/recall";
import { rememberTurnAttachments, resendPayload } from "@/components/shared/composer/turn-attachments";
import {
  parseSlashCommand,
  applySlashCommand,
  isSessionCommand,
  DEFAULT_SESSION_CONTROLS,
} from "@/lib/slash-commands";
import { useModelReady } from "@/hooks/use-model-ready";
import { NoModelCard } from "@/components/shared/no-model-card";
import { useProviderStore } from "@/stores/provider-store";
import { resolveSendRoute } from "@/lib/models/client-options";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import type { Capability } from "@/lib/models/types";
import { useTurnWiring } from "@/hooks/use-turn-wiring";
import { useBuiltinAccess } from "@/hooks/use-builtin-access";
import { useDocumentPrint } from "@/hooks/use-document-print";
import { useScheduledPrompt } from "@/hooks/use-scheduled-prompt";

/** This surface's routing capability — a fixed property of the surface. */
const CAPABILITY = getSurfaceRoute("cowork").capability;

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_FILES: string[] = [];
const EMPTY_CANVASES: import("@/stores/cowork-store").CanvasArtifact[] = [];
const EMPTY_SEARCH_GROUPS: SearchQueryGroup[] = [];

/** Truncate text at the nearest word boundary before maxLen. */
function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.substring(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.5 ? truncated.substring(0, lastSpace) : truncated;
}

// Additional patterns for script output that names a file path (e.g. python-pptx "Saved to /tmp/foo.pptx")
// Matches both absolute (/path/to/file.pptx) and relative (output.pptx) paths
const BASH_OUTPUT_PATH_PATTERNS = [
  /(?:saved?|writ(?:ten|e|ing)|created?|generated?|exported?|output)\s+(?:to\s+|file\s+|as\s+)?['"]?([\w/.~-][\w./-]*\.(?:pptx?|docx?|xlsx?|pdf|csv|png|jpe?g|gif|svg|webp|mp[34]|wav|zip))/gi,
];

// Parse search results from MCP searxng output
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchQueryGroup {
  query: string;
  results: SearchResult[];
}


function fileDisplayName(path: string) {
  return contextEntryDisplayName(path);
}

function openFile(path: string) {
  // Use Electron shell to open files, or fallback to window.open for URLs
  if (path.startsWith("http")) {
    window.open(path, "_blank");
  } else if (window.electronAPI?.openPath) {
    window.electronAPI.openPath(path);
  }
}

function CoworkCanvasToggle() {
  const open = useCanvasStore((s) => !!s.bySurface['cowork']?.open);
  const hasDoc = useCanvasStore((s) => !!s.bySurface['cowork']?.doc);
  const setOpen = useCanvasStore((s) => s.setOpen);
  if (!hasDoc) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen('cowork', !open)}
      className="text-muted-foreground hover:text-foreground transition-colors"
      title={open ? 'Hide canvas' : 'Show canvas'}
    >
      {open ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  );
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
                    {(() => {
                      const { kind } = classifyContextEntry(path);
                      const RowIcon =
                        kind === "search" ? Search
                        : kind === "agent" ? Zap
                        : kind === "command" ? TerminalIcon
                        : Icon;
                      return <RowIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
                    })()}
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

/** Deterministic color from a domain string (for favicon dot). */
function domainColor(domain: string): string {
  const colors = [
    "bg-red-500", "bg-orange-500", "bg-amber-500", "bg-yellow-500",
    "bg-lime-500", "bg-green-500", "bg-emerald-500", "bg-teal-500",
    "bg-cyan-500", "bg-sky-500", "bg-blue-500", "bg-indigo-500",
    "bg-violet-500", "bg-purple-500", "bg-fuchsia-500", "bg-pink-500",
  ];
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function SearchQueryCard({ group }: { group: SearchQueryGroup }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/40 transition-colors"
      >
        <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left truncate text-muted-foreground">{group.query}</span>
        <span className="text-[10px] text-muted-foreground/60 shrink-0">{group.results.length} results</span>
        <ChevronDown className={`h-3 w-3 text-muted-foreground/60 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-0.5">
          {group.results.map((r, i) => {
            const domain = extractDomain(r.url);
            return (
              <a
                key={i}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors group"
              >
                <span className={`h-2.5 w-2.5 rounded-sm shrink-0 ${domainColor(domain)}`} />
                <span className="text-[11px] font-medium text-foreground truncate group-hover:text-primary transition-colors">{r.title}</span>
                <span className="text-[10px] text-muted-foreground/50 shrink-0 ml-auto">{domain}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SearchResultsCard({ groups, onClear }: { groups: SearchQueryGroup[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return null;
  const totalSearches = groups.length;
  return (
    <div className="rounded-xl border border-border/50 bg-card/50">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-semibold">Web Search</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{totalSearches} {totalSearches === 1 ? "search" : "searches"}</span>
          <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        <button
          type="button"
          onClick={onClear}
          className="h-4 w-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {groups.map((g, i) => (
            <SearchQueryCard key={i} group={g} />
          ))}
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
      {/* Always-visible key metrics */}
      <div className="px-4 pb-2 space-y-1">
        {metrics.cost !== undefined && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Agent cost</span>
            <span className="font-mono">${metrics.cost.toFixed(4)}</span>
          </div>
        )}
        {metrics.humanHours !== undefined && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Human estimate</span>
            <span className="font-mono">~{metrics.humanHours < 1 ? `${Math.round(metrics.humanHours * 60)}min` : `${metrics.humanHours}h`}</span>
          </div>
        )}
        {metrics.multiplier !== undefined && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Speed</span>
            <span className="font-mono font-semibold text-green-600 dark:text-green-400">{metrics.multiplier.toFixed(0)}× faster</span>
          </div>
        )}
        {metrics.ttftMs !== undefined && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">TTFT</span>
            <span className="font-mono">{(metrics.ttftMs / 1000).toFixed(1)}s</span>
          </div>
        )}
      </div>
      {/* Expanded details */}
      {open && (
        <div className="px-4 pb-3 space-y-1 border-t border-border/30 pt-2">
          {metrics.dollarsSaved !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">$ saved</span>
              <span className="font-mono">${metrics.dollarsSaved.toFixed(0)}</span>
            </div>
          )}
          {metrics.complexity && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Complexity</span>
              <span className="font-mono">{metrics.complexity}</span>
            </div>
          )}
          {metrics.taskType && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Task type</span>
              <span className="font-mono">{metrics.taskType}{metrics.language ? ` / ${metrics.language}` : ""}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The rail's tab strip.
 *
 * WHY TABS WITH COUNTS RATHER THAN PLAIN TABS. Cowork's rail is a monitoring
 * surface — the point is watching context files get read and artifacts get
 * written while the agent works. Plain tabs would give each panel its full
 * height and take that away, which trades one complaint for a worse one. The
 * count rides on the label, so accumulation stays visible while you read
 * something else.
 *
 * Membership and order come from the registry (DR-20). A panel with nothing in
 * it yet gets no tab — except the three that are always meaningful, which keep
 * theirs so the strip does not reshuffle under the pointer as a run proceeds.
 */
const ALWAYS_TABBED = new Set(['goal-status', 'context', 'artifacts']);

function RailTabs({
  active,
  onSelect,
  counts,
}: {
  active: string;
  onSelect: (id: string) => void;
  counts: Record<string, number>;
}) {
  const tabs = railPanels('cowork').filter(
    (p) => ALWAYS_TABBED.has(p.id) || (counts[p.id] ?? 0) > 0,
  );
  if (tabs.length < 2) return null;

  return (
    <div className="flex flex-wrap gap-1 px-3 pb-2">
      {tabs.map((p) => {
        const n = counts[p.id] ?? 0;
        const isActive = p.id === active;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-pressed={isActive}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
              isActive
                ? "bg-background font-semibold text-foreground"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            }`}
          >
            {p.title}
            {/*
              The count is the whole reason these are tabs rather than a
              switcher: it is what keeps accumulation visible while you are
              reading something else. Shown whenever there is something to
              count — the first version of this line had a nested ternary that
              suppressed it on exactly the panels people watch.
            */}
            {n > 0 ? <span className="text-[10px] text-muted-foreground">{n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function SidebarPanel({
  contextFiles,
  artifactFiles,
  canvasArtifacts,
  folder,
  open,
  onToggle,
  onContextClick,
  onArtifactClick,
  onCanvasClick,
  onContextRemove,
  onArtifactRemove,
  onCanvasRemove,
  searchGroups,
  onClearSearch,
  previewUrl,
  onPreviewClick,
  taskMetrics,
  chatId,
  goalNudge,
  goalStarting,
}: {
  contextFiles: string[];
  artifactFiles: string[];
  canvasArtifacts: import("@/stores/cowork-store").CanvasArtifact[];
  folder: string | null;
  /** Identifies the goal run; a run is per-conversation. */
  chatId: string;
  /** Bumped when a run starts, so the rail updates at once. */
  goalNudge: number;
  /** Planning state, before there is a run to report. */
  goalStarting: { objective: string; phase: 'planning' | 'starting' } | null;
  open: boolean;
  onToggle: () => void;
  onContextClick?: (path: string) => void;
  onArtifactClick?: (path: string) => void;
  onCanvasClick?: (artifact: import("@/stores/cowork-store").CanvasArtifact) => void;
  onContextRemove?: (path: string) => void;
  onArtifactRemove?: (path: string) => void;
  onCanvasRemove?: (artifactId: string) => void;
  searchGroups?: SearchQueryGroup[];
  onClearSearch?: () => void;
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
  /*
    Which rail panel is showing. The rail used to stack all seven, so three open
    cards squashed each other and the tall one — the goal dashboard — pushed the
    rest off-screen.
  */
  const [activeTab, setActiveTab] = useState('goal-status');

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
        <>
        <RailTabs
          active={activeTab}
          onSelect={setActiveTab}
          counts={{
            context: contextFiles.length,
            artifacts: artifactFiles.length,
            canvases: canvasArtifacts.length,
            'search-results': searchGroups?.length ?? 0,
            'task-metrics': taskMetrics ? 1 : 0,
            preview: previewUrl && onPreviewClick ? 1 : 0,
          }}
        />
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

            {/*
              The run's dashboard lives HERE, in the rail.
              
              The transcript narrates what happened; this is the reference view —
              the plan, the spend, the question to answer — and it belongs beside
              Context and Artifacts rather than in the conversation. It renders
              nothing when there is no goal.
            */}
            <RailSlot active={activeTab} surface="cowork" id="goal-status">
              <GoalRunStatus
                chatId={chatId}
                folder={folder}
                surfaceId="cowork"
                nudge={goalNudge}
                starting={goalStarting}
              />
            </RailSlot>

            <RailSlot active={activeTab} surface="cowork" id="context">
              <SidebarCard
                label="Context"
                icon={FileText}
                items={contextFiles}
                emptyText="Files read during this session will appear here."
                onItemClick={onContextClick}
                onItemRemove={onContextRemove}
              />
            </RailSlot>

            <RailSlot active={activeTab} surface="cowork" id="search-results">
              {searchGroups && searchGroups.length > 0 && (
                <SearchResultsCard groups={searchGroups} onClear={onClearSearch || (() => {})} />
              )}
            </RailSlot>

            <RailSlot active={activeTab} surface="cowork" id="artifacts">
              <SidebarCard
                label="Artifacts"
                icon={FilePen}
                items={artifactFiles}
                emptyText="Files created or edited will appear here."
                onItemClick={onArtifactClick}
                onItemRemove={onArtifactRemove}
              />
            </RailSlot>

            <RailSlot active={activeTab} surface="cowork" id="canvases">
  {canvasArtifacts.length > 0 && (
                <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3">
                    <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 text-sm font-semibold">Canvases</span>
                    <span className="text-xs text-muted-foreground">{canvasArtifacts.length}</span>
                    <CoworkCanvasToggle />
                  </div>
                  <div className="px-2 pb-2 space-y-1">
                    {canvasArtifacts.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors group">
                        <button
                          type="button"
                          onClick={() => onCanvasClick?.(c)}
                          className="flex-1 min-w-0 text-left flex items-center gap-2"
                        >
                          <LayoutDashboard className="h-3 w-3 text-primary shrink-0" />
                          <span className="truncate text-xs text-foreground">{c.title}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onCanvasRemove?.(c.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                          title="Remove"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </RailSlot>

            {/* Task Metrics panel */}
            <RailSlot active={activeTab} surface="cowork" id="task-metrics">
              {taskMetrics && <TaskMetricsCard metrics={taskMetrics} />}
            </RailSlot>

            {/* Dev server preview chip */}
            <RailSlot active={activeTab} surface="cowork" id="preview">
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
            </RailSlot>
          </div>
        </ScrollArea>
        </>
      )}
    </div>
  );
}

export function CoworkSurface() {
  /*
   * The tool name and query for an in-flight search, keyed by tool id.
   *
   * `tool_result` carries only the id, and the sidebar card needs the query it
   * was for — refs rather than state because nothing renders from them and a
   * re-render per tool call would be waste.
   */
  const toolNamesById = useRef<Map<string, string>>(new Map());
  const searchQueriesById = useRef<Map<string, string>>(new Map());

  const composerRef = useRef<ComposerHandle>(null);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const searchGroups = useCoworkStore((s) => s.searchGroups[s.currentChatId ?? ""] ?? EMPTY_SEARCH_GROUPS);
  const addSearchGroup = useCoworkStore((s) => s.addSearchGroup);
  const clearSearchGroups = useCoworkStore((s) => s.clearSearchGroups);
  const [previewOpen, setPreviewOpen] = useState(false);
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const setCanvasOpen = useCanvasStore((s) => s.setOpen);
  /** An attachment is context the agent will read — list it in the rail. */
  const noteAttachment = useCallback((file: AttachmentFile) => {
    const cid = useCoworkStore.getState().currentChatId;
    if (cid) useCoworkStore.getState().addContextFile(cid, file.name);
  }, []);
  // Dropped files join the draft of the conversation on screen, like the
  // composer's own attach button and paste.
  const { isDragging, dropZoneProps } = useFileDrop(
    useCallback(
      (file: AttachmentFile) => {
        addComposerAttachment("cowork", useCoworkStore.getState().currentChatId ?? "", file);
        noteAttachment(file);
      },
      [noteAttachment],
    ),
  );
  const currentChatId = useCoworkStore((s) => s.currentChatId);
  const chatId = currentChatId ?? "";
  // Canvas SSE handler — store mutations + telemetry centralised in the hook.
  // Canvas-store lifecycle (clear on conversation change) is handled by <CanvasOverlay />.
  const onCanvasEvent = useCanvasSseHandler('cowork', chatId);
  const messages = useCoworkStore(
    (s) => (s.currentChatId ? s.messages[s.currentChatId] : undefined) ?? EMPTY_MESSAGES
  );
  const modelRoute = useCoworkStore((s) => s.modelRoute);
  // THIS conversation's turn, not the surface's: another chat streaming must
  // neither lock this composer nor give it a Stop button that aborts nothing.
  const isStreaming = useCoworkStore((s) => !!chatId && !!s.streamingChats[chatId]);
  const setChatStreaming = useCoworkStore((s) => s.setChatStreaming);
  const storeFolder = useCoworkStore((s) => chatId ? s.folderByChat[chatId] ?? null : null);
  const folder = storeFolder || pendingFolder;
  const contextFiles = useCoworkStore((s) => (chatId ? s.contextFiles[chatId] : undefined) ?? EMPTY_FILES);
  const artifactFiles = useCoworkStore((s) => (chatId ? s.artifactFiles[chatId] : undefined) ?? EMPTY_FILES);
  const canvasArtifacts = useCoworkStore((s) => (chatId ? s.canvasArtifacts[chatId] : undefined) ?? EMPTY_CANVASES);
  const setModelRoute = useCoworkStore((s) => s.setModelRoute);
  const setFolder = useCoworkStore((s) => s.setFolder);
  const addMessage = useCoworkStore((s) => s.addMessage);
  const appendToLastAssistant = useCoworkStore((s) => s.appendToLastAssistant);
  const addToolCall = useCoworkStore((s) => s.addToolCall);
  const setTurnError = useCoworkStore((s) => s.setTurnError);
  const setRetryStatus = useCoworkStore((s) => s.setRetryStatus);
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
  const truncateMessages = useCoworkStore((s) => s.truncateMessages);
  const setIsStreaming = useCoworkStore((s) => s.setIsStreaming);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const updateConversationMetrics = useConversationStore((s) => s.updateConversationMetrics);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const activeConvId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const personalPreferences = useSettingsStore((s) => s.personalPreferences);
  const printDocument = useDocumentPrint();
  const displayName = useSettingsStore((s) => s.displayName);
  /** Sent with every turn; without it the server never learns search exists. */
  const searchSettings = useSearchSettings();
  const deckTheme = useDeckTheme(chatId);
  // Built-in (Claude) reachability, which is the user's key OR the server's env
  // key OR Bedrock — `anthropicApiKey` alone only knows about the first.
  const { hasAnthropicKey, hasBedrock, known: builtinAccessKnown } = useBuiltinAccess();
  const blockDangerousCommands = useSettingsStore((s) => s.blockDangerousCommands);
  const blockNetworkCommands = useSettingsStore((s) => s.blockNetworkCommands);
  const restrictToProjectFolder = useSettingsStore((s) => s.restrictToProjectFolder);
  const disableBashTool = useSettingsStore((s) => s.disableBashTool);
  const devHourlyRate = useSettingsStore((s) => s.devHourlyRate);
  const tierModels = useSettingsStore((s) => s.tierModels);
  const providers = useProviderStore((s) => s.providers);
  const { projectInstructions, projectKnowledge, projectId: currentProjectId, crossSurfaceContext, projectFolder } = useProjectContext(chatId, "cowork");
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const scratchDir = useScratchDir(chatId);
  // Auto-project creation disabled — users create projects manually
  const { showNotification } = useElectron();

  /**
   * What to send for the picker's current selection: a tier route resolves here
   * (it can land on a user provider's model), a pinned model passes through.
   * Returns null when nothing resolves — callers fall back to the built-in
   * `model` rather than sending an empty one. Shared by all four send sites.
   */
  const resolveRoute = useCallback(
    (capability: Capability = CAPABILITY) =>
      resolveSendRoute(modelRoute, providers, {
        capability,
        tierModels,
        hasAnthropicKey,
        hasBedrock,
        known: builtinAccessKnown,
      }),
    [modelRoute, providers, tierModels, hasAnthropicKey, hasBedrock, builtinAccessKnown]
  );

  /**
   * Everything that describes the USER's setup rather than a particular message.
   *
   * There are two places that start a turn — the composer and the auto-continue
   * — and the second one used to hand-copy a subset of these fields. It dropped
   * eight, including `deckTheme`: a user who had chosen Magazine Bold asked for
   * a themed deck, the turn auto-continued, and the deck came back unstyled
   * because the continuation ran as a user with no theme set. `searchSettings`,
   * `memories`, `projectInstructions`, `projectKnowledge` and the context bus
   * went the same way, silently.
   *
   * Per-MESSAGE things stay out — history, attachments and sessionControls
   * differ legitimately between the two callers. Everything here does not, and
   * `cowork-turn-context.test.tsx` fails if a field is added to one caller and
   * not the other.
   */
  const turnContext = useCallback(
    () => ({
      personalPreferences: personalPreferences || undefined,
      displayName: displayName || undefined,
      projectInstructions: projectInstructions || undefined,
      projectKnowledge: projectKnowledge || undefined,
      cwd: folder || projectFolder || scratchDir || undefined,
      crossSurfaceContext: crossSurfaceContext || undefined,
      securitySettings: {
        blockDangerousCommands,
        blockNetworkCommands,
        restrictToProjectFolder,
        disableBashTool,
      },
      searchSettings,
      deckTheme,
    }),
    [
      personalPreferences,
      displayName,
      projectInstructions,
      projectKnowledge,
      folder,
      projectFolder,
      scratchDir,
      crossSurfaceContext,
      blockDangerousCommands,
      blockNetworkCommands,
      restrictToProjectFolder,
      disableBashTool,
      searchSettings,
      deckTheme,
    ]
  );

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

  // Episodic memory: summarize previous conversation when switching.
  // Also abort any running stream for the old conversation to prevent spillover.
  const prevChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevChatIdRef.current;
    prevChatIdRef.current = chatId || null;
    if (prevId && prevId !== chatId) {
      /*
       * Deliberately NOT aborting the previous conversation's stream.
       *
       * It used to, "so its chunks don't land in the new conversation" — a real
       * concern, already solved somewhere else: `useSSEStream` pins its
       * callbacks at stream start, so output goes to the chat the stream was
       * STARTED for regardless of what is on screen, and
       * `chat-surface.stream.test.tsx` has asserted that for a while.
       *
       * With the spillover handled, the abort only did harm: opening or
       * switching to another chat killed a turn that was still working, and a
       * long research run could not be left to finish while you did something
       * else. Concurrent conversations are the point of a registry keyed by
       * chatId.
       */
      const prevMessages = useCoworkStore.getState().messages[prevId];
      if (prevMessages && prevMessages.length > 0) {
        summarizeConversation(prevId, prevMessages);
      }
    }
  }, [chatId]);

  const ownsChat = useCallback(
    (id: string) => !!useCoworkStore.getState().messages[id]?.length,
    [],
  );
  // Run recording + the two card-answer persisters, shared with the other three
  // surfaces (see use-turn-wiring). This wiring was hand-copied between surfaces,
  // which is how the connect-card defect came to be dealt with in some of them and
  // not others; there is one copy now, and one test.
  const { runRecorder, onQuestionAnswered, onConnectorSettled } = useTurnWiring({
    surfaceId: "cowork",
    chatId,
    ownsChat,
    updateMessage,
  });

  const { sendMessage, abort } = useSSEStream({
    chatId,
    setIsStreaming,
    setChatStreaming,
    coalesceText: true,
    // Every callback is handed the chat its stream was started for. Usage used
    // to be filed against `currentChatId` — whatever was on screen when the
    // turn ENDED — so a long run finished while you read another conversation
    // billed that one.
    onUsage(usage, id) {
      // Composed: the run recorder captures cost first (it must not be skipped
      // by the no-active-conversation early return below), then the existing
      // ROI/telemetry pipeline runs unchanged.
      runRecorder.onUsage(usage);
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
    onChunk(event, cid) {
      // Chunks whose handling is the same on every surface — cron jobs,
      // standing orders, widgets, memory. Handled in ONE place
      // (lib/sse/agnostic-chunks) because each surface having its own case
      // meant three of them were silently dropped on most surfaces.
      if (handleAgnosticChunk(event, { chatId: cid, surface: 'Cowork' })) return;

      // The chunks whose handling is identical across surfaces, recorded once in
      // lib/sse/core-chunks. `skip` names what this surface still owns — see the
      // note there; it is a visible migration step, not a permanent carve-out.
      if (
        handleCoreChunk(event, {
          chatId: cid,
          store: { addMessage, appendToLastAssistant, addToolCall, updateToolResult, completeRunningTools, setTurnError, setRetryStatus },
          printDocument,
          onCanvas: onCanvasEvent,
          notify: (title, body) => {
            if (!document.hasFocus()) showNotification(title, body);
          },
          skip: ['tool_use', 'tool_result'],
        })
      ) {
        return;
      }

      switch (event.type) {
        case "tool_use": {
          // Complete any previously running tools before starting a new one
          completeRunningTools(cid);
          const toolId = (event.id as string) || `tool_${Date.now()}`;
          const toolName = (event.name as string) || "Unknown";
          const toolInput = (event.input as Record<string, unknown>) || {};
          // Resolve relative file_path in Write/Edit tools so artifact Open button works
          const cwd = folder || projectFolder || scratchDir;
          if (cwd && typeof toolInput.file_path === 'string' && !toolInput.file_path.startsWith('/')) {
            toolInput.file_path = `${cwd.replace(/\/$/, '')}/${toolInput.file_path}`;
          }
          addToolCall(cid, {
            id: toolId,
            name: toolName,
            input: toolInput,
            status: "running",
            startTime: Date.now(),
          });
          // The marker can arrive in the command OR in the output — the model
          // either writes the expression or computes it with a script. Same parse
          // both times; it lived here twice, verbatim. See lib/sse/aime-cron.
          if (toolName === "Bash") {
            scheduleFromCronMarker(toolInput.command, "Cowork", "command");
          }
          // Parallel search result fetch — the SDK doesn't expose tool results in the stream,
          // so we call searxng directly when we see a web_search tool_use event.
          /*
           * Not updated when search became pluggable, on either axis.
           *
           * The gate matched only the searxng MCP names, and the in-process
           * tool is `mcp__aime__SearchWeb`, which matches neither — so for a
           * Brave/Tavily/OpenRouter user no fetch fired at all. And the body
           * carried no `settings`, so even a Settings-configured SearXNG fell
           * back to env-only on the server and answered 501; `results` came
           * back empty, `.catch(() => {})` swallowed it, and the SearchResults
           * sidebar stayed permanently blank.
           */
          if (
            (toolName.includes("web_search") ||
              toolName.includes("searxng") ||
              toolName.endsWith("SearchWeb") ||
              toolName === "WebSearch") &&
            toolInput.query
          ) {
            const searchQuery = String(toolInput.query);
            /*
             * Only the FREE backend is re-queried. The paid providers are read
             * from their own tool result in the `tool_result` case below, which
             * costs nothing and shows exactly what the model saw.
             */
            if (isParsableSearchTool(toolName)) {
              toolNamesById.current.set(toolId, toolName);
              searchQueriesById.current.set(toolId, searchQuery);
              return;
            }
            fetch("/api/search-proxy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query: searchQuery,
                max_results: toolInput.max_results || 10,
                settings: searchSettings,
              }),
            })
              .then((r) => r.json())
              .then(({ results }) => {
                if (results && results.length > 0) {
                  if (cid) addSearchGroup(cid, { query: searchQuery, results });
                }
              })
              .catch(() => {});
          }
          // Categorize into sidebar panels
          const categorized = categorizeToolCall(toolName, toolInput, { richContext: true });
          if (categorized && cid && isValidSidebarEntry(categorized.path)) {
            // Skip search query entries — redundant with SearchResultsCard
            if (isSearchEntry(categorized.path)) {
              // Don't add search queries to either panel
            } else if (categorized.category === "context") {
              // Don't add to Context if this path is already in Artifacts
              const currentArtifacts = useCoworkStore.getState().artifactFiles[cid] ?? [];
              if (!currentArtifacts.includes(categorized.path)) {
                addContextFile(cid, categorized.path);
              }
            } else {
              addArtifactFile(cid, categorized.path);
              // Also register as project artifact
              if (currentProjectId) {
                const fileName = categorized.path.split("/").pop() || categorized.path;
                useProjectStore.getState().addArtifact(currentProjectId, {
                  id: crypto.randomUUID(),
                  name: fileName,
                  path: categorized.path,
                  type: "file",
                  surface: "cowork",
                  conversationId: cid,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                });
              }
            }
          }
          // Detect plan file writes
          if (toolName === "Write" && cid) {
            const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "";
            if (filePath.includes(".claude/plans/")) {
              const content = typeof toolInput.content === "string" ? toolInput.content : "";
              if (content) setPlanContent(cid, content);
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
          updateToolResult(cid, id, result, event.is_error as boolean | undefined);
          // Detect dev server URLs in Bash output
          if (result && !event.is_error) {
            const detected = detectServerUrl(result);
            if (detected) setPreviewUrl(detected.url);
          }
          /*
           * Search results come from the tool's OWN output now.
           *
           * The sidebar used to re-run every query against `/api/search-proxy`,
           * which was free against a self-hosted SearXNG and became a doubled
           * bill once the gate covered `SearchWeb` — the Brave/Tavily/OpenRouter
           * path. Twelve agent searches meant twenty-four billable queries, and
           * the card could show a result set the model never saw.
           *
           * The comment this replaces said the SDK does not emit tool_result in
           * the stream. That was true of the branch that read them: it tested
           * `c.type === 'tool_result'`, a message type the SDK has never sent.
           * They arrive inside `user` messages and now reach the client.
           */
          if (result && !event.is_error && cid) {
            const startedAs = toolNamesById.current.get(id);
            if (isParsableSearchTool(startedAs)) {
              const parsed = parseSearchWebResults(result);
              const query = searchQueriesById.current.get(id);
              if (parsed.length > 0 && query) {
                addSearchGroup(cid, { query, results: parsed });
              }
            }
          }
          // Detect binary files mentioned in Bash output (e.g. python-pptx writing a .pptx)
          if (result && !event.is_error && cid) {
            const allMsgs = useCoworkStore.getState().messages[cid];
            const lastMsg = allMsgs?.at(-1);
            const matchingTc = lastMsg?.toolCalls?.find((tc) => tc.id === id);
            // Same marker, the other arrival path — see the note at the command site.
            if (matchingTc?.name === "Bash") {
              scheduleFromCronMarker(result, "Cowork", "output");
            }
            if (matchingTc?.name === "Bash") {
              // Skip scanning curl/wget HTML output — too many false positives from embedded asset URLs
              const bashCmd = typeof matchingTc.input?.command === "string" ? matchingTc.input.command : "";
              const isCurlWget = /\bcurl\b|\bwget\b/.test(bashCmd);
              const coworkState = useCoworkStore.getState();
              const coworkFolder = cid ? coworkState.folderByChat[cid] ?? null : null;
              const cwd = coworkFolder || folder || projectFolder || scratchDir;
              const addBashArtifact = (raw: string) => {
                let filePath = raw;
                if (filePath.length < 3 || filePath.startsWith(".") || filePath === "/dev/null") return;
                if (/^[0-9.:]+$/.test(filePath.replace(/\.(?:pdf|csv|png|jpe?g)$/i, ""))) return;
                if (!isValidSidebarEntry(filePath)) return;
                if (!filePath.startsWith("/") && cwd) {
                  const cwdBasename = cwd.split("/").pop() || "";
                  if (cwdBasename && filePath.startsWith(`${cwdBasename}/`)) {
                    filePath = filePath.slice(cwdBasename.length + 1);
                  }
                  filePath = `${cwd}/${filePath}`;
                }
                addArtifactFile(cid, filePath);
              };
              if (!isCurlWget) {
                BASH_ARTIFACT_EXT.lastIndex = 0;
                let m;
                while ((m = BASH_ARTIFACT_EXT.exec(result)) !== null) addBashArtifact(m[1]);
                for (const pattern of BASH_OUTPUT_PATH_PATTERNS) {
                  pattern.lastIndex = 0;
                  let pm;
                  while ((pm = pattern.exec(result)) !== null) addBashArtifact(pm[1]);
                }
              }
            }
          }
          break;
        }
        case "document_extracting": {
          // Show extraction status in console — could add UI indicator
          console.log('[Cowork] Extracting document:', event.name);
          break;
        }
        case "document_extracted": {
          // Add extracted document to context sidebar, removing the original attachment entry to avoid duplicates
          const extractedPath = event.extractedPath as string | undefined;
          const originalName = event.name as string | undefined;
          if (extractedPath && cid) {
            if (originalName) {
              const existing = useCoworkStore.getState().contextFiles[cid] ?? [];
              const duplicate = existing.find((p) => p === originalName || p.endsWith(`/${originalName}`));
              if (duplicate) removeContextFile(cid, duplicate);
            }
            addContextFile(cid, extractedPath);
          }
          console.log('[Cowork] Document extracted:', event.name, 'path:', extractedPath, 'length:', event.textLength);
          break;
        }
      }
    },
    onDone: (cid) => {
      runRecorder.succeed();
      completeRunningTools(cid);
      stopStreaming(cid);
      const allMsgs = useCoworkStore.getState().messages[cid];
      const lastMsg = allMsgs?.at(-1);
      // (Search results are fetched in parallel via /api/search-proxy when
      // web_search tool_use events arrive in the stream.)
      // Inline plan detection: check last assistant message for plan heading
      if (lastMsg?.role === "assistant" && lastMsg.content && /^#{1,2}\s+plan\b/im.test(lastMsg.content.slice(0, 500))) {
        setPlanContent(cid, lastMsg.content);
      }
      // Detect binary artifacts from Bash tool calls (e.g. python-pptx, generate_presentation.sh).
      // The SDK doesn't emit tool_result events, so we scan Bash command inputs for output file paths.
      if (cid) {
        const coworkState = useCoworkStore.getState();
        const coworkFolder = cid ? coworkState.folderByChat[cid] ?? null : null;
        const cwdFallback = coworkFolder || folder || projectFolder || scratchDir;
        const msgs = useCoworkStore.getState().messages[cid] ?? [];
        for (const msg of msgs) {
          for (const tc of msg.toolCalls ?? []) {
            if (tc.name === "Bash" && tc.input?.command) {
              const cmd = String(tc.input.command);
              BASH_ARTIFACT_EXT.lastIndex = 0;
              let match;
              while ((match = BASH_ARTIFACT_EXT.exec(cmd)) !== null) {
                let filePath = match[1];
                if (filePath.length < 3 || filePath.startsWith(".") || filePath === "/dev/null") continue;
                if (!isValidSidebarEntry(filePath)) continue;
                if (!filePath.startsWith("/") && cwdFallback) {
                  filePath = `${cwdFallback}/${filePath}`;
                }
                const existing = useCoworkStore.getState().artifactFiles[cid] ?? [];
                if (!existing.includes(filePath)) {
                  addArtifactFile(cid, filePath);
                }
              }
            }
          }
        }
      }
      // Verify artifacts still exist on disk and remove phantoms.
      if (cid) {
        const currentArtifacts = useCoworkStore.getState().artifactFiles[cid] ?? [];
        if (currentArtifacts.length > 0 && window.electronAPI?.fileExists) {
          for (const artifactPath of currentArtifacts) {
            // Skip non-absolute paths and bash: labels
            if (!artifactPath.startsWith("/")) continue;
            window.electronAPI.fileExists(artifactPath).then((exists: boolean) => {
              if (!exists) {
                console.log("[Cowork] Removing phantom artifact (file not found):", artifactPath);
                removeArtifactFile(cid, artifactPath);
              }
            }).catch(() => {});
          }
        }
      }
      // Auto-continuation: if the agent ended mid-task (many tool calls + last message
      // suggests more work to do), automatically send a "continue" prompt
      if (cid && allMsgs && allMsgs.length > 2) {
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
            addMessage(cid, { id: crypto.randomUUID(), role: "user", content: continuePrompt, timestamp: Date.now(), isAutoContinue: true } as Message);
            addMessage(cid, { id: crypto.randomUUID(), role: "assistant", content: "", timestamp: Date.now(), isLoading: true, isStreaming: true });
            startStreaming(cid);
            const currentControls = useCoworkStore.getState().sessionControls[cid] ?? DEFAULT_SESSION_CONTROLS;
            const priorMsgs = useCoworkStore.getState().messages[cid] || [];
            const hist = stripMessagesForHistory(priorMsgs.slice(0, -2));
            const route = resolveRoute();
            // A fresh run: the auto-continue is a hook-driven turn of its own,
            // and the turn that triggered it was already closed by succeed().
            runRecorder.begin({ trigger: "hook", model: route?.model ?? undefined });
            void sendMessage(continuePrompt, cid, "cowork", route?.model ?? null, {
              // Spread the shared context rather than re-listing it. The
              // hand-written version of this object omitted deckTheme,
              // searchSettings, memories, projectInstructions,
              // projectKnowledge, crossSurfaceContext, contextBusEvents and
              // securitySettings — so an auto-continued turn ran as a
              // differently-configured user than the one who typed the prompt.
              ...turnContext(),
              history: hist.length > 0 ? hist : undefined,
              sessionControls: currentControls,
              providerConfig: route?.providerConfig,
            });
          }, 1500);
          return; // skip "task complete" notification
        }
      }
      if (!document.hasFocus()) {
        showNotification("Task complete", "The assistant has finished working on your request.");
      }
    },
    onError: (error, cid) => {
      runRecorder.fail(error.message);
      stopStreaming(cid);
      // A banner on the reply, not text in it — see TurnErrorBanner.
      setTurnError(cid, turnErrorOf(error));
    },
  });

  // Ref to break circular dependency: handleSubmit uses resetIdleTimer, but
  // useHeartbeat (which provides resetIdleTimer) is called after handleSubmit.
  const resetIdleTimerRef = useRef<(() => void) | null>(null);

  /**
   * Run a turn for the user message that is ALREADY last in the transcript.
   * Split out so Retry and Edit reuse it rather than calling `handleSubmit`
   * with the old text — which added the question again, kept the failed reply
   * above it, and renamed the chat.
   */
  const startTurn = useCallback(
    async (id: string, trimmed: string, attachments: AttachmentFile[]) => {
      addMessage(id, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isLoading: true,
        isStreaming: true,
      });
      startStreaming(id);
      const currentAttachments = [...attachments];
      if (currentAttachments.length > 0) sendFeatureAdoptionEvent({ feature: 'file_attachment', surface: 'cowork' });
      if (sessionControls.thinkLevel && sessionControls.thinkLevel !== 'off') sendFeatureAdoptionEvent({ feature: 'extended_thinking', surface: 'cowork' });
      if (sessionControls.agentName) sendFeatureAdoptionEvent({ feature: 'agent_routing', surface: 'cowork' });
      // Grab prior messages for history fallback (exclude the user message + assistant placeholder)
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

      // Drain context bus events for this surface
      const { useContextBusStore } = await import('@/stores/context-bus-store');
      const busEvents = useContextBusStore.getState().getUnconsumed('cowork')
        .filter(e => e.priority === 'p0' || e.priority === 'p1')
        .map(e => ({ summary: e.summary, source: e.source, priority: e.priority }));
      if (busEvents.length > 0) {
        useContextBusStore.getState().consumeAll('cowork');
      }

      const currentControls = useCoworkStore.getState().sessionControls[id] ?? DEFAULT_SESSION_CONTROLS;
      const route = resolveRoute();
      // Everything that describes the USER's setup rather than this particular
      // message. Built in one place because the auto-continue path below sends
      // its own turn, and a hand-copied subset there silently dropped eight
      // fields — `deckTheme` among them, which is why a themed deck came back
      // unstyled on an auto-continued turn.
      // Open the run record before the turn starts so an immediate failure is
      // still attributed rather than lost.
      runRecorder.begin({ trigger: "manual", model: route?.model ?? undefined });
      await sendMessage(trimmed, id, "cowork", route?.model ?? null, {
        ...turnContext(),
        providerConfig: route?.providerConfig,
        // Per-message, so deliberately not part of the shared context.
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        history: history.length > 0 ? history : undefined,
        memories: memoriesStr || undefined,
        contextBusEvents: busEvents.length > 0 ? busEvents : undefined,
        sessionControls: currentControls,
      });
    },
    [
      runRecorder,
      resolveRoute,
      // Carries the settings half of the turn; omitting it is how a theme or
      // security change fails to take effect until some other dep happens to
      // change — the same stale-closure bug this list already documents below.
      turnContext,
      addMessage,
      startStreaming,
      sendMessage,
      // Read inside the callback and previously missing, so a slash command, a
      // project switch or a security-setting change did not take effect until
      // another dep changed. All are primitives or stable store references.
      sessionControls,
      currentProjectId,
    ]
  );

  /** Record a new question: its sidebar preview, and a title if the chat has none yet. */
  const touchConversation = useCallback(
    (id: string, text: string) => {
      const conv = useConversationStore.getState().conversations.find((c) => c.id === id);
      updateConversation(id, {
        ...(isUntitled(conv?.title) ? { title: truncateAtWordBoundary(text, 50) } : {}),
        lastMessage: text,
      });
    },
    [updateConversation],
  );

  const handleSubmit = useCallback(
    async (text: string, opts?: { attachments?: AttachmentFile[] }) => {
      if (!text.trim()) return;
      resetIdleTimerRef.current?.();
      const trimmed = text.trim();
      const attachments = opts?.attachments ?? [];

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
          // Shown, never sent to the model: see stripMessagesForHistory.
          addMessage(id, { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: Date.now(), isCommandEcho: true });
          addMessage(id, { id: crypto.randomUUID(), role: 'assistant', content: result.message, timestamp: Date.now(), isCommandEcho: true });
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

      const userMessageId = crypto.randomUUID();
      rememberTurnAttachments(userMessageId, attachments);
      addMessage(id, {
        id: userMessageId,
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
        attachments: attachments.length > 0 ? attachments.map(a => ({ name: a.name, content: '', type: a.type, category: a.category as 'image' | 'document' | 'text' })) : undefined,
      });
      touchConversation(id, trimmed);
      await startTurn(id, trimmed, attachments);
    },
    [
      chatId,
      addMessage,
      addConversation,
      setActiveConversation,
      setCurrentChat,
      sessionControls,
      setSessionControls,
      pendingFolder,
      setFolder,
      touchConversation,
      startTurn,
    ]
  );

  /**
   * Regenerate the last reply: drop it and run the same question again, with
   * its attachments — no duplicate question, no rename.
   */
  const handleRetry = useCallback(() => {
    if (!chatId || isStreaming) return;
    const msgs = useCoworkStore.getState().messages[chatId] ?? [];
    const lastUser = msgs.findLast((m) => m.role === "user" && !m.isAutoContinue);
    if (!lastUser) return;
    const { text, attachments } = resendPayload(lastUser);
    truncateMessages(chatId, lastUser.id);
    void startTurn(chatId, text, attachments);
  }, [chatId, isStreaming, truncateMessages, startTurn]);

  /** Edit a question and ask again: it and everything after it are replaced. */
  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      const trimmed = newText.trim();
      if (!chatId || isStreaming || !trimmed) return;
      const msgs = useCoworkStore.getState().messages[chatId] ?? [];
      const original = msgs.find((m) => m.id === messageId && m.role === "user");
      if (!original) return;
      const { text, attachments } = resendPayload(original, trimmed);
      truncateMessages(chatId, messageId, { inclusive: true });
      const userMessageId = crypto.randomUUID();
      rememberTurnAttachments(userMessageId, attachments);
      addMessage(chatId, {
        id: userMessageId,
        role: "user",
        content: text,
        timestamp: Date.now(),
        attachments: original.attachments,
      });
      touchConversation(chatId, trimmed);
      void startTurn(chatId, text, attachments);
    },
    [chatId, isStreaming, truncateMessages, addMessage, touchConversation, startTurn],
  );

  /*
   * A due cron job runs HERE, through this surface's own submit — not through a
   * scheduler with a send path of its own, which would be a fourth place that
   * starts a turn. Before this, a job published to the bus, switched surface,
   * and nothing ran it.
   */
  useScheduledPrompt('cowork', handleSubmit, () => {
    // Busy means the conversation the job would run in is mid-turn — a turn
    // elsewhere does not block it, since conversations run concurrently.
    const st = useCoworkStore.getState();
    return !!st.currentChatId && !!st.streamingChats[st.currentChatId];
  });


  /*
   * The ONE submit — Enter and the button both land here, so goal mode cannot
   * be honoured by one and ignored by the other (Enter used to send a plain
   * chat message with the goal toggle on). Returns false to keep the draft.
   */
  function submitFromComposer(text: string, attachments: AttachmentFile[]): boolean {
    // Nothing configured could answer — say so instead of sending a doomed turn.
    if (!modelReady && !isSessionCommand(text)) {
      setNoModelAttempted(true);
      return false;
    }
    /*
     * Goal mode is a property of the SEND, not a second composer.
     *
     * The first version put an entire second form under the chat box, so doing
     * one thing meant typing the same sentence into two boxes and working out
     * which was which. The text, the folder and the send button are already
     * here; the toggle only changes what happens to them.
     */
    if (goalMode) {
      const settings = goalSettingsFrom(goalBudget, goalCap);
      if (typeof settings === "string") {
        setGoalError(settings);
        return false;
      }
      if (!folder) {
        setGoalError("Pick a folder first — the plan and progress live there.");
        return false;
      }
      const objective = text;
      /*
       * A conversation has to exist first.
       *
       * The goal branch returned before the auto-create block below, so a brand
       * new chat posted conversationId: "" and the route answered 400 — goal
       * mode simply did not work until you had already sent a normal message.
       */
      if (!chatId) {
        setGoalError("Send a message first, or pick an existing chat — a goal needs a conversation to live in.");
        return false;
      }
      /*
       * Name the chat.
       *
       * A goal run never sent a chat message, so the ordinary titling path never
       * fired and every goal conversation stayed "New Chat" — indistinguishable
       * from every other one in the sidebar. The objective is the best title
       * there is: it is exactly what the run is for.
       */
      if (chatId) {
        const existing = conversations.find((c) => c.id === chatId);
        const untitled = !existing?.title || /^new chat$/i.test(existing.title);
        if (untitled) {
          updateConversation(chatId, {
            title: objective.length > 60 ? `${objective.slice(0, 57)}…` : objective,
          });
        }
      }
      setGoalPending(objective);
      const goalDraft = draftKey("cowork", chatId);
      void startGoal({ conversationId: chatId, workingDir: folder, objective, ...settings }).then(
        (ok) => {
          setGoalPending(null);
          if (ok) {
            useComposerDrafts.getState().clearDraft(goalDraft);
            setGoalMode(false);
            setGoalNudge((n) => n + 1);
          }
        },
      );
      // Kept until the goal has actually started — planning can still fail.
      return false;
    }
    void handleSubmit(text, { attachments });
    return true;
  }

  const hasMessages = messages.length > 0;
  // Stable, so the memoised message rows do not all re-render per token.
  const handleMessageArtifactClick = useCallback((v: string | ParsedArtifact) => {
    if (typeof v === "string") setPreviewPath(v);
  }, []);
  const handleMessagePreviewUrl = useCallback((url: string) => {
    setPreviewUrl(url);
    setPreviewOpen(true);
  }, []);
  const modelReady = useModelReady(modelRoute, CAPABILITY);
  const [noModelAttempted, setNoModelAttempted] = useState(false);

  // Goal mode: a switch on the composer, not a separate surface.
  const [goalMode, setGoalMode] = useState(false);
  const [goalBudget, setGoalBudget] = useState(String(DEFAULT_BUDGET_USD));
  const [goalCap, setGoalCap] = useState(String(DEFAULT_SESSION_CAP));
  const { start: startGoal, phase: goalPhase, error: startError, setError: setGoalError } =
    useStartGoal("cowork", modelRoute ?? null);
  const goalBusy = goalPhase !== "idle";
  /*
   * The run narrates itself into the transcript.
   *
   * Everything a goal did used to live in a side panel while the centre of the
   * screen showed something else — a run that changed real code still read as
   * "I'm not sure it even ran". In a chat app the transcript is the interface.
   */
  useGoalTranscript(chatId, folder, addMessage);
  // The objective is held while planning so the pending card can show it, and
  // bumped on success so the panel appears at once rather than up to 3s later.
  const [goalPending, setGoalPending] = useState<string | null>(null);
  const [goalNudge, setGoalNudge] = useState(0);

  const recallText = lastUserPrompt(messages);
  const attachmentMenu = {
    currentProjectId,
    onAddToProject: (pid: string) => assignToProject(chatId, pid),
    onNewProject: () => setSidebarMode("projects"),
    projects: allProjects.map((p) => ({ id: p.id, name: p.name, icon: p.icon })),
  };
  const composerToolbar = (
    <>
      <FolderPicker folder={folder} onFolderChange={handleFolderChange} scratchActive={!folder && !!scratchDir} />
      <EditorPicker folder={folder} />
      {/*
        On both composers. A conversation that has already said something is
        exactly where a follow-up goal starts, and it was once reachable only
        before the first message.
      */}
      <GoalModeToggle on={goalMode} onChange={setGoalMode} disabled={goalBusy} />
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
    </>
  );
  const composerModel = (
    <ModelSelector
      value={modelRoute?.id ?? ''}
      onSelectModel={setModelRoute}
      capability={CAPABILITY}
      className="border-0 bg-transparent shadow-none h-6 w-auto text-muted-foreground"
    />
  );
  // Attached to the composer, not a box under a box — the numbers belong to
  // the send button they change the meaning of.
  const goalBar = goalMode ? (
    <GoalModeBar
      budget={goalBudget} cap={goalCap}
      onBudget={setGoalBudget} onCap={setGoalCap}
      disabled={goalBusy} error={startError}
    />
  ) : null;
  const composerProps = {
    ref: composerRef,
    surface: "cowork",
    conversationId: chatId,
    onSubmit: submitFromComposer,
    isStreaming,
    onStop: abort,
    submitDisabled: goalBusy,
    submitLabel: goalMode ? "Plan and start the goal" : "Send message",
    recallText,
    mentionCwd: folder || projectFolder || scratchDir || null,
    onAttachmentAdded: noteAttachment,
    attachmentMenu,
    // The run's question belongs where the conversation is, not in a rail.
    header: (
      <>
        {!modelReady && <NoModelCard attempted={noModelAttempted} />}
        <GoalQuestion chatId={chatId} folder={folder} surfaceId="cowork" />
      </>
    ),
    belowInput: goalBar,
    toolbarStart: composerToolbar,
    toolbarEnd: composerModel,
  };

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
            Select a folder and describe your task — the assistant will read, write, and edit files alongside you.
          </p>

          {/* Centered input card */}
          <div className="w-full max-w-2xl">
            <Composer {...composerProps} variant="hero" placeholder="What would you like to work on?" />

            {folder && (
              <div className="mx-auto mt-3 w-full max-w-[672px]">
                <GoalRunStatus
                  chatId={chatId}
                  folder={folder}
                  surfaceId="cowork"
                  nudge={goalNudge}
                  starting={
                    goalPending && goalPhase !== "idle"
                      ? { objective: goalPending, phase: goalPhase }
                      : null
                  }
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Active state: messages + sidebar (no header bar) ── */
        <div className="relative flex flex-1 min-h-0 overflow-hidden">
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
            <MessageList messages={messages} surfaceId="cowork" onQuestionAnswered={onQuestionAnswered} onConnectorSettled={onConnectorSettled} onArtifactClick={handleMessageArtifactClick} onPreviewUrl={handleMessagePreviewUrl} onRetry={handleRetry} onEditMessage={isStreaming ? undefined : handleEditMessage} showReasoning={sessionControls.reasoningVisible} expandToolCalls={sessionControls.verboseMode} onCancel={chatId ? () => streamRegistry.abort(chatId) : undefined} conversationId={chatId} />

            {/* Bottom input card */}
            <div className="px-6 pb-4 pt-2">
              <div className="max-w-3xl mx-auto">
                <Composer {...composerProps} placeholder="Describe your task..." />
              </div>
            </div>
          </div>

          {/* Sidebar: Context + Artifacts */}
          <SidebarPanel
            chatId={chatId}
            goalNudge={goalNudge}
            goalStarting={
              goalPending && goalPhase !== "idle"
                ? { objective: goalPending, phase: goalPhase }
                : null
            }
            contextFiles={contextFiles}
            artifactFiles={artifactFiles}
            canvasArtifacts={canvasArtifacts}
            folder={folder}
            open={sidebarOpen}
            onToggle={() => setSidebarOpen((prev) => !prev)}
            onCanvasClick={(c) => {
              pushCanvas('cowork', c.doc, chatId || null);
              setCanvasOpen('cowork', true);
            }}
            onCanvasRemove={(id) => {
              if (chatId) useCoworkStore.getState().removeCanvasArtifact(chatId, id);
            }}
            onContextClick={(path) => {
              // Non-file entries: search queries, bash commands, agent labels — no-op
              if (!isOpenableEntry(path)) return;
              // URLs open in browser
              if (path.startsWith("http")) {
                window.open(path, "_blank");
              } else {
                // Resolve relative paths against the working folder
                const resolved = folder && !path.startsWith("/") ? `${folder}/${path}` : path;
                setPreviewPath(resolved);
              }
            }}
            onArtifactClick={(path) => {
              // Resolve relative paths against the working folder (or scratch dir)
              const cwd = folder || projectFolder || scratchDir;
              if (cwd && !path.startsWith("/")) {
                setPreviewPath(`${cwd}/${path}`);
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
            searchGroups={searchGroups}
            onClearSearch={() => { if (chatId) clearSearchGroups(chatId); }}
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

          {/* Canvas overlay — slides in over the chat content */}
          <CanvasOverlay surfaceId="cowork" conversationId={chatId} />
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
