"use client";

import type { WidgetNode, WidgetTone, WidgetTrend } from "@/lib/widgets/catalog";
import { isKnownAction, ACTION_LABEL, type WidgetActionHandler } from "@/lib/widgets/actions";
import { WidgetChart } from "./widget-chart";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

/**
 * Renders a validated WidgetNode tree.
 *
 * One recursive switch, one branch per catalogued primitive, plain JSX
 * throughout. Explicitly NO `dangerouslySetInnerHTML` anywhere — the catalogue's
 * whole promise is that a generated tile cannot inject markup, and that promise
 * lives or dies here.
 *
 * Callers must pass a node that has already been through `coerceNode`/
 * `parseWidget`. The Cockpit re-validates on every render even for nodes from
 * its own store: we don't trust our own stored bytes, because they originated
 * from a model reading data we don't control.
 */

const TONE_CLASS: Record<WidgetTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  danger: "bg-red-500/15 text-red-700 dark:text-red-400",
  info: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
};

const TREND_CLASS: Record<WidgetTrend, string> = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
};

function TrendIcon({ state }: { state?: WidgetTrend }) {
  if (!state) return null;
  const cls = `h-3 w-3 ${TREND_CLASS[state]}`;
  if (state === "up") return <ArrowUp className={cls} />;
  if (state === "down") return <ArrowDown className={cls} />;
  return <ArrowRight className={cls} />;
}

const TEXT_VARIANT: Record<string, string> = {
  heading: "text-sm font-semibold",
  subheading: "text-xs font-medium",
  body: "text-xs",
  caption: "text-[11px] text-muted-foreground",
  label: "text-[10px] uppercase tracking-wide text-muted-foreground",
};

export interface WidgetRendererProps {
  node: WidgetNode | null;
  /** Omit to render action buttons visibly disabled. */
  onAction?: WidgetActionHandler;
}

export function WidgetRenderer({ node, onAction }: WidgetRendererProps) {
  if (!node) return null;

  switch (node.type) {
    case "text":
      return <p className={TEXT_VARIANT[node.variant ?? "body"]}>{node.text}</p>;

    case "metric":
      return (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{node.label}</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-semibold tabular-nums">{node.value}</span>
            {node.delta && (
              <span className={`flex items-center gap-0.5 text-xs ${TREND_CLASS[node.state ?? "neutral"]}`}>
                <TrendIcon state={node.state} />
                {node.delta}
              </span>
            )}
          </div>
        </div>
      );

    case "statGrid":
      return (
        <div className="grid grid-cols-2 gap-3">
          {node.items.map((s, i) => (
            <div key={i}>
              <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-semibold tabular-nums">{s.value}</span>
                {s.delta && (
                  <span className={`text-[11px] ${TREND_CLASS[s.state ?? "neutral"]}`}>{s.delta}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      );

    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag className={`space-y-1 text-xs ${node.ordered ? "list-decimal pl-4" : ""}`}>
          {node.items.map((item, i) => (
            <li key={i} className="flex items-start gap-1.5">
              {!node.ordered && <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />}
              <span className="min-w-0 flex-1">
                <span>{item.text}</span>
                {item.sub && <span className="block text-[11px] text-muted-foreground">{item.sub}</span>}
              </span>
              {item.badge && (
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground">
                  {item.badge}
                </span>
              )}
            </li>
          ))}
        </Tag>
      );
    }

    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60">
                {node.columns.map((c, i) => (
                  <th key={i} className="px-1.5 py-1 text-left font-medium text-muted-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/30 last:border-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-1.5 py-1 tabular-nums">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "keyValue":
      return (
        <dl className="space-y-1 text-xs">
          {node.rows.map((r, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <dt className="shrink-0 text-muted-foreground">{r.key}</dt>
              <dd className="min-w-0 flex-1 truncate text-right tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      );

    case "badge":
      return (
        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${TONE_CLASS[node.tone ?? "neutral"]}`}>
          {node.text}
        </span>
      );

    case "timeline":
      return (
        <ol className="space-y-2">
          {node.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-xs">
              <div className="flex flex-col items-center">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {i < node.items.length - 1 && <span className="w-px flex-1 bg-border" />}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                {item.time && <p className="text-[10px] text-muted-foreground">{item.time}</p>}
                <p className="truncate font-medium">{item.title}</p>
                {item.sub && <p className="truncate text-[11px] text-muted-foreground">{item.sub}</p>}
              </div>
            </li>
          ))}
        </ol>
      );

    case "progress":
      return (
        <div className="space-y-1">
          {node.label && (
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span className="truncate">{node.label}</span>
              <span className="tabular-nums">{Math.round(node.value)}%</span>
            </div>
          )}
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(node.value)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${node.value}%` }} />
          </div>
        </div>
      );

    case "chart":
      return <WidgetChart chart={node.chart} points={node.points} title={node.title} unit={node.unit} />;

    case "divider":
      return <hr className="border-border/60" />;

    case "image":
      // Coercer guarantees a data: URL, so there is no network request here.
      // eslint-disable-next-line @next/next/no-img-element -- data: URL only, never remote; next/image would add nothing here
      return <img src={node.src} alt={node.alt ?? ""} className="max-h-48 w-auto rounded-md" />;

    case "actionButton": {
      // An action the host cannot service renders visibly disabled rather than
      // silently doing nothing — a button that looks live and isn't is worse
      // than one that admits it.
      const supported = Boolean(onAction) && isKnownAction(node.action);
      return (
        <button
          type="button"
          disabled={!supported}
          title={supported ? ACTION_LABEL[node.action] : "This action isn't available here"}
          onClick={() => {
            if (supported && isKnownAction(node.action)) void onAction!(node.action);
          }}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            supported
              ? `${TONE_CLASS[node.tone ?? "neutral"]} hover:opacity-80`
              : "cursor-not-allowed bg-muted/50 text-muted-foreground/50"
          }`}
        >
          {node.label}
        </button>
      );
    }

    case "section":
      return (
        <section className="space-y-2">
          {node.title && (
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {node.title}
            </h4>
          )}
          {node.children.map((child, i) => (
            <WidgetRenderer key={i} node={child} onAction={onAction} />
          ))}
        </section>
      );

    case "card":
      return (
        <div className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
          {node.title && <p className="text-sm font-medium">{node.title}</p>}
          {node.subtitle && <p className="text-xs text-muted-foreground">{node.subtitle}</p>}
          {node.children.map((child, i) => (
            <WidgetRenderer key={i} node={child} onAction={onAction} />
          ))}
        </div>
      );
  }
}
