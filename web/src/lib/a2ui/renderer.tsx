'use client';

/**
 * A2UI React renderer — Premium edition.
 * Renders A2UIDocument components with polished card styling.
 * Supports light, dark, and emma themes via CSS variables.
 */

import React from 'react';
import type {
  A2UIComponent,
  A2UIDocument,
  A2UIAction,
  TableComponent,
  ChartComponent,
  KanbanComponent,
  StatComponent,
  FormComponent,
  MarkdownComponent,
  ListComponent,
  ProgressComponent,
  ActionCardComponent,
  TodoComponent,
  ApprovalCardComponent,
  TimelineComponent,
  MermaidComponent,
} from './types';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidBlock } from '@/components/shared/mermaid-block';

// ── Shared primitives ────────────────────────────────────────────────────────

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow ${className ?? ''}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle, icon, trailing }: { title?: string; subtitle?: string; icon?: string; trailing?: React.ReactNode }) {
  if (!title && !subtitle) return null;
  return (
    <div className="flex items-start justify-between px-5 pt-4 pb-2">
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="text-lg mt-0.5">{icon}</span>}
        <div className="min-w-0">
          {title && <h3 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h3>}
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {trailing && <div className="shrink-0 ml-3">{trailing}</div>}
    </div>
  );
}

function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-5 pb-4 ${className ?? ''}`}>{children}</div>;
}

function PillBadge({ children, variant }: { children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'error' | 'info' }) {
  const colors = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${colors[variant || 'default']}`}>
      {children}
    </span>
  );
}

function ActionButton({ label, variant, onClick }: { label: string; variant?: 'primary' | 'secondary' | 'destructive'; onClick?: () => void }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors ${styles[variant || 'secondary']}`}
    >
      {label}
    </button>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

function TableRenderer({ component }: { component: TableComponent }) {
  const columns = component.columns ?? [];
  const rows = component.rows ?? [];
  return (
    <div>
      <CardHeader title={component.title} />
      <div className="px-1 pb-3">
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40">
                {columns.map((col) => (
                  <th key={col.key} className="text-left py-2.5 px-4 font-medium text-xs uppercase tracking-wider text-muted-foreground border-b border-border/40">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors">
                  {columns.map((col) => {
                    const val = row[col.key];
                    return (
                      <td key={col.key} className="py-2.5 px-4 text-foreground">
                        {col.type === 'badge' ? (
                          <PillBadge>{String(val ?? '')}</PillBadge>
                        ) : (
                          <span>{String(val ?? '')}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function ChartRenderer({ component }: { component: ChartComponent }) {
  const series = component.series ?? [];
  const allData = series.flatMap((s) => s.data ?? []);
  const maxVal = Math.max(...allData.map((d) => d.value), 1);

  return (
    <div>
      <CardHeader title={component.title} />
      <CardBody>
        {component.chartType === 'pie' ? (
          <div className="space-y-2.5">
            {(series[0]?.data ?? []).map((d) => {
              const total = allData.reduce((s, x) => s + x.value, 0) || 1;
              const pct = Math.round((d.value / total) * 100);
              return (
                <div key={d.label} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm" style={{ background: d.color || 'var(--primary)' }} />
                  <span className="text-sm flex-1 text-foreground">{d.label}</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{pct}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {(series[0]?.data ?? []).map((d) => (
              <div key={d.label}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{d.value}</span>
                </div>
                <div className="w-full bg-muted/60 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(d.value / maxVal) * 100}%`,
                      background: d.color || 'var(--primary)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </div>
  );
}

// ── Kanban ────────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  high: 'border-l-destructive bg-destructive/5',
  medium: 'border-l-yellow-500 bg-yellow-500/5',
  low: 'border-l-muted-foreground',
};

function KanbanRenderer({ component, onAction }: { component: KanbanComponent; onAction?: (action: A2UIAction) => void }) {
  const columns = component.columns ?? [];
  return (
    <div>
      <CardHeader title={component.title} />
      <CardBody>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {columns.map((col) => {
            const cards = col.cards ?? [];
            return (
            <div key={col.id} className="flex-shrink-0 w-52">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{col.title}</span>
                <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5 text-muted-foreground">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((card) => (
                  <div key={card.id} className={`rounded-lg border border-border/50 bg-card p-3 shadow-sm border-l-2 ${PRIORITY_COLORS[card.priority || ''] || 'border-l-transparent'}`}>
                    {card.url ? (
                      <a href={card.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-foreground hover:underline">
                        {card.title}
                      </a>
                    ) : (
                      <div className="text-sm font-medium text-foreground">{card.title}</div>
                    )}
                    {card.description && <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{card.description}</div>}
                    {card.labels && card.labels.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {card.labels.map((l) => <PillBadge key={l}>{l}</PillBadge>)}
                      </div>
                    )}
                    {card.actions && card.actions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {card.actions.map((a) => {
                          const styles = a.variant === 'primary'
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : a.variant === 'destructive'
                              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                              : 'bg-muted text-foreground hover:bg-muted/70 border border-border/40';
                          return (
                            <button
                              key={a.actionId}
                              type="button"
                              onClick={() => {
                                if (a.tool) {
                                  onAction?.({ type: 'tool-call', componentId: component.id, tool: a.tool, args: a.args ?? {}, feedbackPrompt: a.feedbackPrompt });
                                } else {
                                  onAction?.({ type: 'button-click', componentId: component.id, actionId: a.actionId, payload: { cardId: card.id, ...a.args } });
                                }
                              }}
                              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${styles}`}
                            >
                              {a.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            );
          })}
        </div>
      </CardBody>
    </div>
  );
}

// ── Stat ──────────────────────────────────────────────────────────────────────

function StatRenderer({ component }: { component: StatComponent }) {
  const stats = component.stats ?? [];
  return (
    <div>
      <CardHeader title={component.title} />
      <CardBody>
        <div className="grid grid-cols-2 gap-3">
          {stats.map((stat, i) => (
            <div key={i} className="rounded-lg bg-muted/30 border border-border/30 p-3.5">
              <div className="text-xs text-muted-foreground font-medium">{stat.label}</div>
              <div className="text-2xl font-bold mt-1 tabular-nums text-foreground">{String(stat.value)}</div>
              {stat.trend && (
                <div className={`flex items-center gap-1 text-xs mt-1 font-medium ${
                  stat.trend === 'up' ? 'text-green-600 dark:text-green-400' :
                  stat.trend === 'down' ? 'text-red-600 dark:text-red-400' :
                  'text-muted-foreground'
                }`}>
                  <span>{stat.trend === 'up' ? '↑' : stat.trend === 'down' ? '↓' : '→'}</span>
                  <span>{stat.trendValue}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardBody>
    </div>
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────

function FormRenderer({ component, onAction }: { component: FormComponent; onAction?: (action: A2UIAction) => void }) {
  const fields = component.fields ?? [];
  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.defaultValue !== undefined) defaults[field.name] = field.defaultValue;
    }
    return defaults;
  });

  return (
    <div>
      <CardHeader title={component.title} />
      <CardBody>
        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2.5 h-24 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  placeholder={field.placeholder}
                  value={String(values[field.name] ?? '')}
                  onChange={(e) => setValues(v => ({ ...v, [field.name]: e.target.value }))}
                />
              ) : field.type === 'select' ? (
                <select
                  className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  value={String(values[field.name] ?? '')}
                  onChange={(e) => setValues(v => ({ ...v, [field.name]: e.target.value }))}
                >
                  <option value="">Select...</option>
                  {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : field.type === 'checkbox' ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.name])}
                    onChange={(e) => setValues(v => ({ ...v, [field.name]: e.target.checked }))}
                    className="rounded border-border"
                  />
                  <span className="text-sm text-foreground">{field.placeholder || field.label}</span>
                </label>
              ) : (
                <input
                  type={field.type}
                  className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  placeholder={field.placeholder}
                  value={String(values[field.name] ?? '')}
                  onChange={(e) => setValues(v => ({ ...v, [field.name]: field.type === 'number' ? Number(e.target.value) : e.target.value }))}
                />
              )}
            </div>
          ))}
          <ActionButton
            label={component.submitLabel || 'Submit'}
            variant="primary"
            onClick={() => onAction?.({ type: 'form-submit', componentId: component.id, values })}
          />
        </div>
      </CardBody>
    </div>
  );
}

// ── Markdown ──────────────────────────────────────────────────────────────────

function MarkdownRenderer({ component }: { component: MarkdownComponent }) {
  return (
    <div>
      <CardHeader title={component.title} />
      <CardBody>
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{component.content}</ReactMarkdown>
        </div>
      </CardBody>
    </div>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

function ListRenderer({ component, onAction }: { component: ListComponent; onAction?: (action: A2UIAction) => void }) {
  const items = component.items ?? [];
  return (
    <div>
      <CardHeader title={component.title} />
      <CardBody>
        <div className="divide-y divide-border/30">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              {typeof item.checked === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => onAction?.({ type: 'list-toggle', componentId: component.id, itemId: item.id, checked: e.target.checked })}
                  className="mt-0.5 flex-shrink-0 rounded border-border"
                />
              ) : (
                <span className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary/60" />
              )}
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${item.checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{item.text}</span>
                {item.subtext && <div className="text-xs text-muted-foreground mt-0.5">{item.subtext}</div>}
              </div>
              {item.icon && <span className="text-sm shrink-0">{item.icon}</span>}
            </div>
          ))}
        </div>
      </CardBody>
    </div>
  );
}

// ── Progress ──────────────────────────────────────────────────────────────────

function ProgressRenderer({ component }: { component: ProgressComponent }) {
  const items = component.items ?? [];
  return (
    <div>
      <CardHeader title={component.title} />
      <CardBody>
        <div className="space-y-4">
          {items.map((item, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs mb-2">
                <span className="font-medium text-foreground">{item.label}</span>
                <span className="font-semibold tabular-nums text-foreground">{item.value}%</span>
              </div>
              <div className="w-full bg-muted/60 rounded-full h-2.5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, item.value))}%`,
                    background: item.color || 'var(--primary)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </div>
  );
}

// ── Action Card ──────────────────────────────────────────────────────────────

function ActionCardRenderer({ component, onAction }: { component: ActionCardComponent; onAction?: (action: A2UIAction) => void }) {
  const actions = component.actions ?? [];
  return (
    <div>
      <CardHeader
        title={component.title}
        subtitle={component.subtitle}
        icon={component.icon}
        trailing={component.source ? <PillBadge>{component.source}</PillBadge> : undefined}
      />
      <CardBody>
        {component.description && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">{component.description}</p>
        )}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <ActionButton
                key={action.actionId}
                label={action.label}
                variant={action.variant || 'secondary'}
                onClick={() => onAction?.({ type: 'button-click', componentId: component.id, actionId: action.actionId })}
              />
            ))}
          </div>
        )}
      </CardBody>
    </div>
  );
}

// ── Todo ─────────────────────────────────────────────────────────────────────

const TODO_PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-400',
};

function TodoRenderer({ component, onAction }: { component: TodoComponent; onAction?: (action: A2UIAction) => void }) {
  const items = component.items ?? [];
  const [newItemText, setNewItemText] = React.useState('');
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div>
      <CardHeader
        title={component.title}
        subtitle={component.date}
        trailing={<span className="text-xs text-muted-foreground tabular-nums">{doneCount}/{items.length}</span>}
      />
      <CardBody>
        <div className="divide-y divide-border/20">
          {items.map((item, idx) => (
            <div key={item.id} className="flex items-center gap-3 py-2.5 group first:pt-0">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(e) => onAction?.({ type: 'todo-toggle', componentId: component.id, itemId: item.id, done: e.target.checked })}
                className="flex-shrink-0 rounded border-border h-4 w-4"
              />
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {item.priority && (
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TODO_PRIORITY_DOT[item.priority] || ''}`} />
                )}
                <span className={`text-sm ${item.done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {item.text}
                </span>
              </div>
              {item.time && <span className="text-xs text-muted-foreground tabular-nums shrink-0">{item.time}</span>}
              <div className="hidden group-hover:flex gap-1 shrink-0">
                {idx > 0 && (
                  <button type="button" className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors" onClick={() => {
                    const ids = items.map(i => i.id);
                    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
                    onAction?.({ type: 'todo-reorder', componentId: component.id, itemIds: ids });
                  }}>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                  </button>
                )}
                {idx < items.length - 1 && (
                  <button type="button" className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors" onClick={() => {
                    const ids = items.map(i => i.id);
                    [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
                    onAction?.({ type: 'todo-reorder', componentId: component.id, itemIds: ids });
                  }}>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3 pt-3 border-t border-border/30">
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newItemText.trim()) {
                onAction?.({ type: 'todo-add', componentId: component.id, text: newItemText.trim() });
                setNewItemText('');
              }
            }}
            placeholder="Add item..."
            className="flex-1 text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          />
          <ActionButton
            label="Add"
            variant="secondary"
            onClick={() => {
              if (newItemText.trim()) {
                onAction?.({ type: 'todo-add', componentId: component.id, text: newItemText.trim() });
                setNewItemText('');
              }
            }}
          />
        </div>
      </CardBody>
    </div>
  );
}

// ── Approval Card ────────────────────────────────────────────────────────────

function ApprovalCardRenderer({ component, onAction }: { component: ApprovalCardComponent; onAction?: (action: A2UIAction) => void }) {
  const [comment, setComment] = React.useState('');
  const decided = component.status !== 'pending';

  return (
    <div>
      <CardHeader
        title={component.title}
        icon={decided ? (component.status === 'approved' ? '✓' : '✗') : '⚠️'}
        trailing={
          decided ? (
            <PillBadge variant={component.status === 'approved' ? 'success' : 'error'}>
              {component.status === 'approved' ? 'Approved' : 'Rejected'}
            </PillBadge>
          ) : (
            <PillBadge variant="warning">Pending</PillBadge>
          )
        }
      />
      <CardBody>
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">{component.description}</p>
        {component.metadata && Object.keys(component.metadata).length > 0 && (
          <div className="rounded-lg bg-muted/30 border border-border/30 p-3 mb-3 space-y-1">
            {Object.entries(component.metadata).map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-foreground">{v}</span>
              </div>
            ))}
          </div>
        )}
        {!decided && (
          <>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional comment..."
              className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2.5 h-16 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors mb-3"
            />
            <div className="flex gap-2">
              <ActionButton
                label="Approve"
                variant="primary"
                onClick={() => onAction?.({ type: 'approval', componentId: component.id, decision: 'approve', comment: comment || undefined })}
              />
              <ActionButton
                label="Reject"
                variant="destructive"
                onClick={() => onAction?.({ type: 'approval', componentId: component.id, decision: 'reject', comment: comment || undefined })}
              />
            </div>
          </>
        )}
      </CardBody>
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────

const TIMELINE_STATUS_COLORS: Record<string, { dot: string; bg: string }> = {
  success: { dot: 'bg-green-500', bg: 'bg-green-500/10' },
  error: { dot: 'bg-red-500', bg: 'bg-red-500/10' },
  warning: { dot: 'bg-yellow-500', bg: 'bg-yellow-500/10' },
  info: { dot: 'bg-blue-500', bg: 'bg-blue-500/10' },
};

function TimelineRenderer({ component }: { component: TimelineComponent }) {
  const entries = component.entries ?? [];
  return (
    <div>
      <CardHeader title={component.title} />
      <CardBody>
        <div className="relative pl-6">
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border/60" />
          {entries.map((entry, i) => {
            const colors = TIMELINE_STATUS_COLORS[entry.status || 'info'] || TIMELINE_STATUS_COLORS.info;
            return (
              <div key={entry.id} className="relative flex items-start gap-3 pb-4 last:pb-0">
                <div className={`absolute left-[-17px] top-1.5 w-[11px] h-[11px] rounded-full border-2 border-card ${colors.dot} ring-2 ring-card`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] text-muted-foreground tabular-nums">{entry.timestamp}</span>
                    {entry.icon && <span className="text-xs">{entry.icon}</span>}
                  </div>
                  <div className="text-sm text-foreground font-medium">{entry.label}</div>
                  {entry.detail && <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{entry.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </div>
  );
}

// ── Mermaid ──────────────────────────────────────────────────────────────────

function MermaidRendererCard({ component }: { component: MermaidComponent }) {
  return (
    <div>
      <CardHeader title={component.title} />
      <CardBody>
        <MermaidBlock chart={component.code} />
        {component.caption && (
          <p className="mt-2 text-xs text-muted-foreground italic text-center">{component.caption}</p>
        )}
      </CardBody>
    </div>
  );
}

// ── Component dispatcher ──────────────────────────────────────────────────────

function A2UIComponentRenderer({ component, onAction }: { component: A2UIComponent; onAction?: (action: A2UIAction) => void }) {
  switch (component.type) {
    case 'table': return <TableRenderer component={component} />;
    case 'chart': return <ChartRenderer component={component} />;
    case 'kanban': return <KanbanRenderer component={component} onAction={onAction} />;
    case 'stat': return <StatRenderer component={component} />;
    case 'form': return <FormRenderer component={component} onAction={onAction} />;
    case 'markdown': return <MarkdownRenderer component={component} />;
    case 'list': return <ListRenderer component={component} onAction={onAction} />;
    case 'progress': return <ProgressRenderer component={component} />;
    case 'action-card': return <ActionCardRenderer component={component} onAction={onAction} />;
    case 'todo': return <TodoRenderer component={component} onAction={onAction} />;
    case 'approval-card': return <ApprovalCardRenderer component={component} onAction={onAction} />;
    case 'timeline': return <TimelineRenderer component={component} />;
    case 'mermaid': return <MermaidRendererCard component={component} />;
    default:
      return <div className="text-xs text-muted-foreground px-5 py-3">Unknown component type</div>;
  }
}

// ── Per-component error boundary ─────────────────────────────────────────────

class ComponentErrorBoundary extends React.Component<
  { children: React.ReactNode; componentType?: string },
  { hasError: boolean; message?: string }
> {
  constructor(props: { children: React.ReactNode; componentType?: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }
  componentDidCatch(error: Error) {
    console.error('[a2ui] Component crashed:', this.props.componentType, error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="px-5 py-3 text-xs text-muted-foreground">
          <div className="font-medium text-destructive mb-1">Could not render {this.props.componentType ?? 'component'}</div>
          <div className="font-mono opacity-70">{this.state.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Document renderer ─────────────────────────────────────────────────────────

export function A2UIDocumentRenderer({ doc, onAction }: { doc: A2UIDocument; onAction?: (action: A2UIAction) => void }) {
  const components = doc.components ?? [];
  // Note: we deliberately don't render `doc.title` here — the canvas-panel
  // header already shows it. Rendering it twice creates a visible "gap" at
  // the top of the content area when the agent passes the same title at
  // both levels (which is the common case).
  return (
    <div className="space-y-4 p-4">
      {components.map((component, i) => (
        <CardShell key={component.id ?? `c-${i}`}>
          <ComponentErrorBoundary componentType={component.type}>
            <A2UIComponentRenderer component={component} onAction={onAction} />
          </ComponentErrorBoundary>
        </CardShell>
      ))}
    </div>
  );
}
