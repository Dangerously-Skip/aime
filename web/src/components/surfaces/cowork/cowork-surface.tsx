"use client";

import { useState, useCallback, useRef } from "react";
import { MessageList } from "@/components/shared/message-list";
import { ModelSelector } from "@/components/shared/model-selector";
import { FolderPicker } from "@/components/shared/folder-picker";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { useCoworkStore } from "@/stores/cowork-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { parseSearchWebResults, isParsableSearchTool } from "@/lib/search/parse-results";
import { scheduleFromCronMarker } from "@/lib/sse/aime-cron";
import { useProjectContext } from "@/hooks/use-project-context";
import { useProjectStore } from "@/stores/project-store";
import { useAppStore } from "@/stores/app-store";
import { sendConversationCompletedEvent } from "@/lib/telemetry/events";
import { useScratchDir } from "@/hooks/use-scratch-dir";
import { ContinueInSurface } from "@/components/shared/continue-in-surface";
import { useFileDrop } from "@/hooks/use-file-drop";
import { DropOverlay } from "@/components/shared/drop-overlay";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
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
import { DEFAULT_SESSION_CONTROLS } from "@/lib/slash-commands";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useSurfaceTurn, type SessionControlsAccess } from "@/hooks/use-surface-turn";
import { useTurnSettings, memoriesFor, drainContextBus } from "@/hooks/use-turn-settings";

/** This surface's routing capability — a fixed property of the surface. */
const CAPABILITY = getSurfaceRoute("cowork").capability;

const EMPTY_FILES: string[] = [];
const EMPTY_CANVASES: import("@/stores/cowork-store").CanvasArtifact[] = [];
const EMPTY_SEARCH_GROUPS: SearchQueryGroup[] = [];

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

/** Slash-command settings live per conversation in the cowork store. */
const SESSION_CONTROLS: SessionControlsAccess = {
  get: (id) => useCoworkStore.getState().sessionControls[id] ?? DEFAULT_SESSION_CONTROLS,
  set: (id, controls) => useCoworkStore.getState().setSessionControls(id, controls),
};

/** What the model is told when a turn looks like it ran out of turns mid-task. */
const CONTINUE_PROMPT =
  "Continue — complete the file generation. Do not re-explain what you've done. Execute the remaining tool calls to produce the deliverable.";

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
  const chatId = useCoworkStore((s) => s.currentChatId) ?? "";
  const onCanvas = useCanvasSseHandler("cowork");
  const modelRoute = useCoworkStore((s) => s.modelRoute);
  const storeFolder = useCoworkStore((s) => chatId ? s.folderByChat[chatId] ?? null : null);
  const folder = storeFolder || pendingFolder;
  const contextFiles = useCoworkStore((s) => (chatId ? s.contextFiles[chatId] : undefined) ?? EMPTY_FILES);
  const artifactFiles = useCoworkStore((s) => (chatId ? s.artifactFiles[chatId] : undefined) ?? EMPTY_FILES);
  const canvasArtifacts = useCoworkStore((s) => (chatId ? s.canvasArtifacts[chatId] : undefined) ?? EMPTY_CANVASES);
  const setModelRoute = useCoworkStore((s) => s.setModelRoute);
  const setFolder = useCoworkStore((s) => s.setFolder);
  const addMessage = useCoworkStore((s) => s.addMessage);
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
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const updateConversationMetrics = useConversationStore((s) => s.updateConversationMetrics);
  const conversations = useConversationStore((s) => s.conversations);
  const devHourlyRate = useSettingsStore((s) => s.devHourlyRate);
  const { projectInstructions, projectKnowledge, projectId: currentProjectId, crossSurfaceContext, projectFolder } = useProjectContext(chatId, "cowork");
  const settings = useTurnSettings(chatId, { projectInstructions, projectKnowledge, crossSurfaceContext });
  const allProjects = useProjectStore((s) => s.projects);
  const assignToProject = useConversationStore((s) => s.assignToProject);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const scratchDir = useScratchDir(chatId);

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

  /** Where relative paths the agent writes resolve: the folder, the project's, or scratch. */
  const cwd = folder || projectFolder || scratchDir;

  const turn = useSurfaceTurn({
    surface: "cowork",
    label: "Cowork",
    store: useCoworkStore,
    capability: CAPABILITY,
    modelRoute,
    sessionControls: SESSION_CONTROLS,
    onCanvas,
    summarizeOnLeave: true,
    // A folder picked before the conversation existed belongs to it.
    onConversationCreated: (id) => {
      if (!pendingFolder) return;
      setFolder(id, pendingFolder);
      setPendingFolder(null);
    },
    /*
     * EVERY cowork turn — typed, scheduled, handed over, or the auto-continue
     * below — builds its request here. The auto-continue used to hand-copy a
     * subset and had drifted eight fields short: a user who chose Magazine Bold
     * got an unstyled deck whenever the turn auto-continued, because the
     * continuation ran as a user with no theme set.
     */
    request: async ({ chatId: id, text }) => {
      if (currentProjectId) useProjectStore.getState().addConversationToProject(currentProjectId, "cowork", id);
      return {
        ...settings,
        cwd: cwd || undefined,
        memories: memoriesFor(text, currentProjectId),
        contextBusEvents: await drainContextBus("cowork"),
      };
    },
    chunks: {
      core: (cid) => ({
        // Resolve a relative file_path so the artifact panel's Open button works.
        normaliseToolInput: (_name, input) =>
          cwd && typeof input.file_path === "string" && !input.file_path.startsWith("/")
            ? { ...input, file_path: `${cwd.replace(/\/$/, "")}/${input.file_path}` }
            : input,
        onToolStarted: (toolId, toolName, toolInput) => {
          // The marker can arrive in the command OR in the output — the model
          // either writes the expression or computes it with a script. Same parse
          // both times. See lib/sse/aime-cron.
          if (toolName === "Bash") {
            scheduleFromCronMarker(toolInput.command, "Cowork", "command");
          }
          /*
           * Every search backend, not only the searxng MCP names — the
           * in-process tool is `mcp__aime__SearchWeb`, and a Settings-configured
           * provider needs its `settings` sent, or the proxy answers 501 and
           * the sidebar stays blank.
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
             * from their own tool result below, which costs nothing and shows
             * exactly what the model saw.
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
                settings: settings.searchSettings,
              }),
            })
              .then((r) => r.json())
              .then(({ results }) => {
                if (results && results.length > 0) addSearchGroup(cid, { query: searchQuery, results });
              })
              .catch(() => {});
          }
          // Categorize into sidebar panels
          const categorized = categorizeToolCall(toolName, toolInput, { richContext: true });
          // Search queries are left out of both panels — the search card has them.
          if (categorized && isValidSidebarEntry(categorized.path) && !isSearchEntry(categorized.path)) {
            if (categorized.category === "context") {
              // Don't add to Context if this path is already in Artifacts
              const currentArtifacts = useCoworkStore.getState().artifactFiles[cid] ?? [];
              if (!currentArtifacts.includes(categorized.path)) addContextFile(cid, categorized.path);
            } else {
              addArtifactFile(cid, categorized.path);
              if (currentProjectId) {
                useProjectStore.getState().addArtifact(currentProjectId, {
                  id: crypto.randomUUID(),
                  name: categorized.path.split("/").pop() || categorized.path,
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
          if (toolName === "Write") {
            const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "";
            const content = typeof toolInput.content === "string" ? toolInput.content : "";
            if (filePath.includes(".claude/plans/") && content) setPlanContent(cid, content);
          }
        },
        onToolResult: (id, result, isError) => {
          if (!result || isError) return;
          // Detect dev server URLs in Bash output
          const detected = detectServerUrl(result);
          if (detected) setPreviewUrl(detected.url);
          /*
           * Search results come from the tool's OWN output. Re-running every
           * query against `/api/search-proxy` doubled the bill on the paid
           * providers, and could show a result set the model never saw.
           */
          if (isParsableSearchTool(toolNamesById.current.get(id))) {
            const parsed = parseSearchWebResults(result);
            const query = searchQueriesById.current.get(id);
            if (parsed.length > 0 && query) addSearchGroup(cid, { query, results: parsed });
          }
          const matchingTc = useCoworkStore.getState().messages[cid]?.at(-1)?.toolCalls?.find((tc) => tc.id === id);
          if (matchingTc?.name !== "Bash") return;
          // Same marker, the other arrival path — see the note at the command site.
          scheduleFromCronMarker(result, "Cowork", "output");
          // Binary files a script names in its output (e.g. python-pptx writing a
          // .pptx). curl/wget output is skipped: embedded asset URLs are noise.
          const bashCmd = typeof matchingTc.input?.command === "string" ? matchingTc.input.command : "";
          if (/\bcurl\b|\bwget\b/.test(bashCmd)) return;
          const base = useCoworkStore.getState().folderByChat[cid] || cwd;
          const addBashArtifact = (raw: string) => {
            let filePath = raw;
            if (filePath.length < 3 || filePath.startsWith(".") || filePath === "/dev/null") return;
            if (/^[0-9.:]+$/.test(filePath.replace(/\.(?:pdf|csv|png|jpe?g)$/i, ""))) return;
            if (!isValidSidebarEntry(filePath)) return;
            if (!filePath.startsWith("/") && base) {
              const baseName = base.split("/").pop() || "";
              if (baseName && filePath.startsWith(`${baseName}/`)) filePath = filePath.slice(baseName.length + 1);
              filePath = `${base}/${filePath}`;
            }
            addArtifactFile(cid, filePath);
          };
          BASH_ARTIFACT_EXT.lastIndex = 0;
          let m;
          while ((m = BASH_ARTIFACT_EXT.exec(result)) !== null) addBashArtifact(m[1]);
          for (const pattern of BASH_OUTPUT_PATH_PATTERNS) {
            pattern.lastIndex = 0;
            let pm;
            while ((pm = pattern.exec(result)) !== null) addBashArtifact(pm[1]);
          }
        },
      }),
      after: (event, cid) => {
        if (event.type !== "document_extracted") return;
        // The extracted text replaces the original attachment in the context rail.
        const extractedPath = event.extractedPath as string | undefined;
        const originalName = event.name as string | undefined;
        if (!extractedPath) return;
        if (originalName) {
          const existing = useCoworkStore.getState().contextFiles[cid] ?? [];
          const duplicate = existing.find((p) => p === originalName || p.endsWith(`/${originalName}`));
          if (duplicate) removeContextFile(cid, duplicate);
        }
        addContextFile(cid, extractedPath);
      },
    },
    // Usage is filed against the chat the turn ran in, never the one on screen
    // when it ended — a long run finished while you read another conversation
    // used to bill that one.
    onUsage: (usage, id) => {
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
    onDone: (cid, { startTurn }) => {
      const allMsgs = useCoworkStore.getState().messages[cid] ?? [];
      const lastMsg = allMsgs.at(-1);
      // Inline plan detection: check last assistant message for plan heading
      if (lastMsg?.role === "assistant" && lastMsg.content && /^#{1,2}\s+plan\b/im.test(lastMsg.content.slice(0, 500))) {
        setPlanContent(cid, lastMsg.content);
      }
      // Binary artifacts named in Bash commands (e.g. python-pptx,
      // generate_presentation.sh) — some scripts write without saying so.
      const base = useCoworkStore.getState().folderByChat[cid] || cwd;
      for (const msg of allMsgs) {
        for (const tc of msg.toolCalls ?? []) {
          if (tc.name !== "Bash" || !tc.input?.command) continue;
          const cmd = String(tc.input.command);
          BASH_ARTIFACT_EXT.lastIndex = 0;
          let match;
          while ((match = BASH_ARTIFACT_EXT.exec(cmd)) !== null) {
            let filePath = match[1];
            if (filePath.length < 3 || filePath.startsWith(".") || filePath === "/dev/null") continue;
            if (!isValidSidebarEntry(filePath)) continue;
            if (!filePath.startsWith("/") && base) filePath = `${base}/${filePath}`;
            if (!(useCoworkStore.getState().artifactFiles[cid] ?? []).includes(filePath)) addArtifactFile(cid, filePath);
          }
        }
      }
      // Verify artifacts still exist on disk and remove phantoms.
      const fileExists = window.electronAPI?.fileExists;
      if (fileExists) {
        for (const artifactPath of useCoworkStore.getState().artifactFiles[cid] ?? []) {
          // Skip non-absolute paths and bash: labels
          if (!artifactPath.startsWith("/")) continue;
          fileExists(artifactPath).then((exists: boolean) => {
            if (!exists) removeArtifactFile(cid, artifactPath);
          }).catch(() => {});
        }
      }
      // Auto-continuation: the agent ended mid-task (many tool calls, and the
      // last message says more is coming), so ask it to carry on.
      if (allMsgs.length <= 2) return;
      const totalToolCalls = allMsgs.reduce((sum, m) => sum + (m.toolCalls?.length ?? 0), 0);
      const lastContent = lastMsg?.content?.trim() ?? "";
      const looksUnfinished = totalToolCalls >= 10 && /\b(let me|i'll|i will|now (let|i)|going to|next[,.]?\s*(i|let))\b/i.test(lastContent.slice(-300));
      if (!looksUnfinished) return;
      // Small delay so the UI shows the partial response before we continue
      setTimeout(() => {
        addMessage(cid, { id: crypto.randomUUID(), role: "user", content: CONTINUE_PROMPT, timestamp: Date.now(), isAutoContinue: true });
        // A fresh Run: the continuation is a hook-driven turn of its own.
        void startTurn(cid, CONTINUE_PROMPT, [], undefined, { trigger: "hook" });
      }, 1500);
      return true; // carrying on — no "task complete" yet
    },
  });
  const { messages, isStreaming } = turn;

  /*
   * The ONE submit — Enter and the button both land here, so goal mode cannot
   * be honoured by one and ignored by the other (Enter used to send a plain
   * chat message with the goal toggle on). Returns false to keep the draft.
   */
  function submitFromComposer(text: string, attachments: AttachmentFile[]): boolean {
    // Nothing configured could answer — say so instead of sending a doomed turn.
    if (!turn.guardModel(text)) return false;
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
      const existing = conversations.find((c) => c.id === chatId);
      const untitled = !existing?.title || /^new chat$/i.test(existing.title);
      if (untitled) {
        updateConversation(chatId, {
          title: objective.length > 60 ? `${objective.slice(0, 57)}…` : objective,
        });
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
    void turn.submit(text, attachments);
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
    ...turn.composer,
    ref: composerRef,
    onSubmit: submitFromComposer,
    submitDisabled: goalBusy,
    submitLabel: goalMode ? "Plan and start the goal" : "Send message",
    mentionCwd: cwd || null,
    onAttachmentAdded: noteAttachment,
    attachmentMenu,
    // The run's question belongs where the conversation is, not in a rail.
    header: (
      <>
        {turn.noModelCard}
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
            <MessageList {...turn.transcript} surfaceId="cowork" onArtifactClick={handleMessageArtifactClick} onPreviewUrl={handleMessagePreviewUrl} showReasoning={sessionControls.reasoningVisible} expandToolCalls={sessionControls.verboseMode} />

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
              setPreviewPath(cwd && !path.startsWith("/") ? `${cwd}/${path}` : path);
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
