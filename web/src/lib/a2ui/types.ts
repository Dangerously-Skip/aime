/**
 * A2UI — Agent-to-UI type system.
 * Defines the JSON schema for structured UI documents pushed by the agent via the `canvas` tool.
 */

export type A2UIComponentType =
  | 'table'
  | 'chart'
  | 'kanban'
  | 'stat'
  | 'form'
  | 'markdown'
  | 'list'
  | 'progress'
  | 'action-card'
  | 'todo'
  | 'approval-card'
  | 'timeline'
  | 'mermaid';

// ── Column/Row types ──────────────────────────────────────────────────────────

export interface TableColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'badge' | 'date';
}

export type TableRow = Record<string, string | number | boolean | null>;

// ── Chart types ───────────────────────────────────────────────────────────────

export type ChartType = 'bar' | 'line' | 'pie';

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface ChartSeries {
  name: string;
  data: ChartDataPoint[];
  color?: string;
}

// ── Kanban types ──────────────────────────────────────────────────────────────

export interface KanbanCardAction {
  /** Identifier emitted in the action when clicked. */
  actionId: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  /**
   * Optional MCP tool to call directly via canvas action dispatch. When set,
   * clicking the action emits a `tool-call` A2UIAction; otherwise it emits
   * a plain `button-click` carrying the actionId.
   */
  tool?: string;
  /** Args passed when `tool` is set. */
  args?: Record<string, unknown>;
  /** Optional human-readable feedback prompt for the agent after the call. */
  feedbackPrompt?: string;
  /**
   * If set, clicking the action opens a popover with a text input rather than
   * firing immediately. On submit, the user's text is merged into `args` under
   * `argKey` (default: "text") and the tool-call is dispatched.
   * Used for actions like "Comment" that need free-form text.
   */
  inputPrompt?: {
    label: string;
    placeholder?: string;
    /** Field name in `args` to populate with the user's text. Default: "text". */
    argKey?: string;
    /** Render a `<textarea>` instead of single-line `<input>`. Default: false. */
    multiline?: boolean;
    /** Reject empty/whitespace submissions. Default: true. */
    required?: boolean;
  };
}

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  labels?: string[];
  priority?: 'low' | 'medium' | 'high';
  /** Per-card action buttons (e.g. transition to next status, assign, comment). */
  actions?: KanbanCardAction[];
  /** External URL the title links to (e.g. Jira issue link). */
  url?: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
  /**
   * Optional spec for "drop a card onto this column" — used by drag-and-drop
   * across columns. When a card is dropped here, the renderer fires the
   * specified tool with `args` merged with `{ [argKey]: card.id }` (default
   * argKey: "issueIdOrKey") so the agent can transition the issue without
   * needing per-card buttons.
   *
   * For Jira: columns set `tool: "mcp__..._transitionJiraIssue"` and
   * `argKey: "issueIdOrKey"`, with args including the destination transition
   * `{ transition: { id: "..." } }`.
   */
  dropAction?: {
    tool: string;
    args?: Record<string, unknown>;
    argKey?: string;
    feedbackPrompt?: string;
  };
}

// ── Stat types ────────────────────────────────────────────────────────────────

export type StatTrend = 'up' | 'down' | 'neutral';

// ── Form types ────────────────────────────────────────────────────────────────

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'checkbox' | 'date';
  placeholder?: string;
  options?: string[]; // for select
  required?: boolean;
  defaultValue?: string | number | boolean;
}

// ── List types ────────────────────────────────────────────────────────────────

export interface ListItem {
  id: string;
  text: string;
  checked?: boolean;
  subtext?: string;
  icon?: string;
}

// ── Component definitions ─────────────────────────────────────────────────────

export interface TableComponent {
  type: 'table';
  id: string;
  title?: string;
  columns: TableColumn[];
  rows: TableRow[];
}

export interface ChartComponent {
  type: 'chart';
  id: string;
  title?: string;
  chartType: ChartType;
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
}

export interface KanbanComponent {
  type: 'kanban';
  id: string;
  title?: string;
  columns: KanbanColumn[];
}

export interface StatComponent {
  type: 'stat';
  id: string;
  title?: string;
  stats: Array<{
    label: string;
    value: string | number;
    trend?: StatTrend;
    trendValue?: string;
  }>;
}

export interface FormComponent {
  type: 'form';
  id: string;
  title?: string;
  fields: FormField[];
  submitLabel?: string;
}

export interface MarkdownComponent {
  type: 'markdown';
  id: string;
  title?: string;
  content: string;
}

export interface ListComponent {
  type: 'list';
  id: string;
  title?: string;
  ordered?: boolean;
  items: ListItem[];
}

export interface ProgressComponent {
  type: 'progress';
  id: string;
  title?: string;
  items: Array<{
    label: string;
    value: number; // 0-100
    color?: string;
  }>;
}

// ── Action Card types ────────────────────────────────────────────────────────

export interface ActionCardAction {
  actionId: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  /**
   * Optional MCP tool to call directly via canvas action dispatch. When set,
   * clicking emits a `tool-call` A2UIAction; otherwise it emits a plain
   * `button-click` carrying the actionId.
   */
  tool?: string;
  /** Args passed when `tool` is set. */
  args?: Record<string, unknown>;
  /** Optional human-readable feedback prompt for the agent after the call. */
  feedbackPrompt?: string;
}

export interface ActionCardComponent {
  type: 'action-card';
  id: string;
  title?: string;
  subtitle?: string;
  description?: string;
  icon?: string;
  source?: string;
  timestamp?: number;
  actions: ActionCardAction[];
}

// ── Todo types ───────────────────────────────────────────────────────────────

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  priority?: 'low' | 'medium' | 'high';
  time?: string;
}

export interface TodoComponent {
  type: 'todo';
  id: string;
  title?: string;
  date?: string;
  items: TodoItem[];
}

// ── Approval Card types ──────────────────────────────────────────────────────

export interface ApprovalCardComponent {
  type: 'approval-card';
  id: string;
  title?: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  metadata?: Record<string, string>;
}

// ── Timeline types ───────────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  timestamp: string;
  label: string;
  detail?: string;
  icon?: string;
  status?: 'success' | 'error' | 'info' | 'warning';
}

export interface TimelineComponent {
  type: 'timeline';
  id: string;
  title?: string;
  entries: TimelineEntry[];
}

// ── Mermaid types ────────────────────────────────────────────────────────────

export interface MermaidComponent {
  type: 'mermaid';
  id: string;
  title?: string;
  /** Mermaid source (graph, flowchart, erDiagram, mindmap, sequenceDiagram, etc.) */
  code: string;
  /** Caption shown below the diagram */
  caption?: string;
}

// ── Component union ──────────────────────────────────────────────────────────

export type A2UIComponent =
  | TableComponent
  | ChartComponent
  | KanbanComponent
  | StatComponent
  | FormComponent
  | MarkdownComponent
  | ListComponent
  | ProgressComponent
  | ActionCardComponent
  | TodoComponent
  | ApprovalCardComponent
  | TimelineComponent
  | MermaidComponent;

// ── Canvas document ───────────────────────────────────────────────────────────

export interface A2UIDocument {
  version: '1';
  title?: string;
  components: A2UIComponent[];
  /**
   * Optional prompt that re-renders this canvas after a tool-call action
   * fires. The canvas-overlay runs this through /api/subagent and replaces
   * the current doc with the result. Lets templates like jira_kanban show
   * fresh state after a transition without the user having to re-ask.
   *
   * Example: "Re-fetch the PROM kanban from Jira and rebuild the canvas."
   */
  refreshPrompt?: string;
}

// ── Interaction types ─────────────────────────────────────────────────────────

export type A2UIAction =
  | { type: 'list-toggle'; componentId: string; itemId: string; checked: boolean }
  | { type: 'form-submit'; componentId: string; values: Record<string, unknown> }
  | { type: 'button-click'; componentId: string; actionId: string; payload?: Record<string, unknown> }
  | { type: 'todo-toggle'; componentId: string; itemId: string; done: boolean }
  | { type: 'todo-add'; componentId: string; text: string }
  | { type: 'todo-reorder'; componentId: string; itemIds: string[] }
  | { type: 'approval'; componentId: string; decision: 'approve' | 'reject'; comment?: string }
  /**
   * Writeback action — invokes an MCP tool from a templated canvas.
   * The router POSTs `{ tool, args }` to /api/canvas-action which dispatches
   * the call against the active provisioned MCP servers, then optionally
   * follows up with a `feedbackPrompt` to the chat agent.
   */
  | { type: 'tool-call'; componentId: string; tool: string; args: Record<string, unknown>; feedbackPrompt?: string };
