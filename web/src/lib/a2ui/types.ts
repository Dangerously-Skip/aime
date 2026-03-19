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
  | 'progress';

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

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  labels?: string[];
  priority?: 'low' | 'medium' | 'high';
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
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

export type A2UIComponent =
  | TableComponent
  | ChartComponent
  | KanbanComponent
  | StatComponent
  | FormComponent
  | MarkdownComponent
  | ListComponent
  | ProgressComponent;

// ── Canvas document ───────────────────────────────────────────────────────────

export interface A2UIDocument {
  version: '1';
  title?: string;
  components: A2UIComponent[];
}
