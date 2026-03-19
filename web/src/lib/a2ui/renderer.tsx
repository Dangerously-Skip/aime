'use client';

/**
 * A2UI React renderer.
 * Renders A2UIDocument components using shadcn/ui primitives.
 * No eval, no arbitrary JSX — only pre-approved component types.
 */

import React from 'react';
import type {
  A2UIComponent,
  A2UIDocument,
  TableComponent,
  ChartComponent,
  KanbanComponent,
  StatComponent,
  FormComponent,
  MarkdownComponent,
  ListComponent,
  ProgressComponent,
} from './types';
import { Badge } from '@/components/ui/badge';

// Inline primitive replacements for missing shadcn components
function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={`w-full bg-muted rounded-full overflow-hidden ${className ?? ''}`}>
      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-card ${className ?? ''}`}>{children}</div>;
}
function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 ${className ?? ''}`}>{children}</div>;
}

// ── Table ─────────────────────────────────────────────────────────────────────

function TableRenderer({ component }: { component: TableComponent }) {
  return (
    <div>
      {component.title && <h3 className="text-sm font-semibold mb-2">{component.title}</h3>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              {component.columns.map((col) => (
                <th key={col.key} className="text-left py-2 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {component.rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                {component.columns.map((col) => {
                  const val = row[col.key];
                  return (
                    <td key={col.key} className="py-2 px-3">
                      {col.type === 'badge' ? (
                        <Badge variant="secondary">{String(val ?? '')}</Badge>
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
  );
}

// ── Chart (simple text-based fallback when recharts is unavailable) ───────────

function ChartRenderer({ component }: { component: ChartComponent }) {
  const allData = component.series.flatMap((s) => s.data);
  const maxVal = Math.max(...allData.map((d) => d.value), 1);

  return (
    <div>
      {component.title && <h3 className="text-sm font-semibold mb-2">{component.title}</h3>}
      {component.chartType === 'pie' ? (
        // Simple legend-style pie fallback
        <div className="space-y-2">
          {component.series[0]?.data.map((d) => {
            const pct = Math.round((d.value / allData.reduce((s, x) => s + x.value, 0)) * 100);
            return (
              <div key={d.label} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: d.color || 'var(--primary)' }} />
                <span className="text-sm flex-1">{d.label}</span>
                <span className="text-sm text-muted-foreground">{pct}%</span>
              </div>
            );
          })}
        </div>
      ) : (
        // Bar/line — horizontal bar chart fallback
        <div className="space-y-2">
          {component.series[0]?.data.map((d) => (
            <div key={d.label} className="flex items-center gap-2">
              <span className="text-xs w-24 shrink-0 truncate text-muted-foreground">{d.label}</span>
              <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(d.value / maxVal) * 100}%`,
                    background: d.color || 'var(--primary)',
                  }}
                />
              </div>
              <span className="text-xs w-12 text-right text-muted-foreground">{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Kanban ────────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-muted text-muted-foreground',
};

function KanbanRenderer({ component }: { component: KanbanComponent }) {
  return (
    <div>
      {component.title && <h3 className="text-sm font-semibold mb-2">{component.title}</h3>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {component.columns.map((col) => (
          <div key={col.id} className="flex-shrink-0 w-48">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{col.title}</div>
            <div className="space-y-2">
              {col.cards.map((card) => (
                <div key={card.id} className="rounded-md border border-border bg-card p-2 text-xs shadow-sm">
                  <div className="font-medium">{card.title}</div>
                  {card.description && <div className="mt-1 text-muted-foreground">{card.description}</div>}
                  {card.priority && (
                    <span className={`mt-1 inline-block px-1.5 py-0.5 rounded text-xs ${PRIORITY_COLORS[card.priority] || ''}`}>
                      {card.priority}
                    </span>
                  )}
                  {card.labels && card.labels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {card.labels.map((l) => <Badge key={l} variant="outline" className="text-xs px-1">{l}</Badge>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat ──────────────────────────────────────────────────────────────────────

function StatRenderer({ component }: { component: StatComponent }) {
  return (
    <div>
      {component.title && <h3 className="text-sm font-semibold mb-2">{component.title}</h3>}
      <div className="grid grid-cols-2 gap-3">
        {component.stats.map((stat, i) => (
          <Card key={i} className="p-3">
            <CardContent className="p-0">
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className="text-xl font-bold mt-1">{String(stat.value)}</div>
              {stat.trend && (
                <div className={`text-xs mt-0.5 ${stat.trend === 'up' ? 'text-green-600' : stat.trend === 'down' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {stat.trend === 'up' ? '↑' : stat.trend === 'down' ? '↓' : '→'} {stat.trendValue}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────

function FormRenderer({ component }: { component: FormComponent }) {
  return (
    <div>
      {component.title && <h3 className="text-sm font-semibold mb-3">{component.title}</h3>}
      <div className="space-y-3">
        {component.fields.map((field) => (
          <div key={field.name}>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                className="w-full text-sm rounded border border-border bg-background px-2 py-1 h-20 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={field.placeholder}
                defaultValue={String(field.defaultValue ?? '')}
                readOnly
              />
            ) : field.type === 'select' ? (
              <select className="w-full text-sm rounded border border-border bg-background px-2 py-1 focus:outline-none" disabled>
                {field.options?.map((opt) => <option key={opt}>{opt}</option>)}
              </select>
            ) : field.type === 'checkbox' ? (
              <input type="checkbox" defaultChecked={Boolean(field.defaultValue)} disabled />
            ) : (
              <input
                type={field.type}
                className="w-full text-sm rounded border border-border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={field.placeholder}
                defaultValue={String(field.defaultValue ?? '')}
                readOnly
              />
            )}
          </div>
        ))}
        <button type="button" className="mt-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium" disabled>
          {component.submitLabel || 'Submit'}
        </button>
      </div>
    </div>
  );
}

// ── Markdown ──────────────────────────────────────────────────────────────────

function MarkdownRenderer({ component }: { component: MarkdownComponent }) {
  return (
    <div>
      {component.title && <h3 className="text-sm font-semibold mb-2">{component.title}</h3>}
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
        {component.content}
      </div>
    </div>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

function ListRenderer({ component }: { component: ListComponent }) {
  return (
    <div>
      {component.title && <h3 className="text-sm font-semibold mb-2">{component.title}</h3>}
      <ul className="space-y-1">
        {component.items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            {typeof item.checked === 'boolean' ? (
              <input type="checkbox" checked={item.checked} readOnly className="mt-0.5 flex-shrink-0" />
            ) : (
              <span className="mt-0.5 flex-shrink-0 text-muted-foreground">{component.ordered ? '•' : '–'}</span>
            )}
            <div>
              <span className={item.checked ? 'line-through text-muted-foreground' : ''}>{item.text}</span>
              {item.subtext && <div className="text-xs text-muted-foreground">{item.subtext}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Progress ──────────────────────────────────────────────────────────────────

function ProgressRenderer({ component }: { component: ProgressComponent }) {
  return (
    <div>
      {component.title && <h3 className="text-sm font-semibold mb-2">{component.title}</h3>}
      <div className="space-y-3">
        {component.items.map((item, i) => (
          <div key={i}>
            <div className="flex justify-between text-xs mb-1">
              <span>{item.label}</span>
              <span className="text-muted-foreground">{item.value}%</span>
            </div>
            <Progress value={item.value} className="h-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Component dispatcher ──────────────────────────────────────────────────────

function A2UIComponentRenderer({ component }: { component: A2UIComponent }) {
  switch (component.type) {
    case 'table': return <TableRenderer component={component} />;
    case 'chart': return <ChartRenderer component={component} />;
    case 'kanban': return <KanbanRenderer component={component} />;
    case 'stat': return <StatRenderer component={component} />;
    case 'form': return <FormRenderer component={component} />;
    case 'markdown': return <MarkdownRenderer component={component} />;
    case 'list': return <ListRenderer component={component} />;
    case 'progress': return <ProgressRenderer component={component} />;
    default:
      return <div className="text-xs text-muted-foreground">Unknown component type</div>;
  }
}

// ── Document renderer ─────────────────────────────────────────────────────────

export function A2UIDocumentRenderer({ doc }: { doc: A2UIDocument }) {
  return (
    <div className="space-y-6 p-4">
      {doc.title && (
        <h2 className="text-base font-semibold">{doc.title}</h2>
      )}
      {doc.components.map((component) => (
        <Card key={component.id}>
          <CardContent className="pt-4">
            <A2UIComponentRenderer component={component} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
