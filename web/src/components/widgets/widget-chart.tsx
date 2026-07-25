"use client";

import type { ChartKind, ChartPoint } from "@/lib/widgets/catalog";

/**
 * Pure-SVG chart renderer for the `chart` node — bar / line / area / pie.
 *
 * No charting library, no canvas, no executable surface: React-built <svg> over
 * numbers the coercer already validated, with all text React-escaped. Adding a
 * charting dependency here would mean shipping a large surface to render four
 * shapes, and would undercut the "declarative, never executable" guarantee the
 * catalogue exists to make.
 *
 * Responsive via viewBox rather than measurement, so it needs no layout effect.
 */

const PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444",
  "#06b6d4", "#a855f7", "#84cc16", "#f43f5e",
];

const W = 320;
const H = 150;
const PAD = { top: 8, right: 8, bottom: 20, left: 8 };

function niceValue(v: number, unit?: string): string {
  const n = Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v * 100) / 100);
  return unit ? `${n}${unit}` : n;
}

/** Bar / line / area share one linear scale. */
function XY({ chart, points, unit }: { chart: ChartKind; points: ChartPoint[]; unit?: string }) {
  const n = points.length;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - min) / span) * plotH;
  const zeroY = y(0);

  // Declutter: with many points, label only the ends.
  const showLabel = (i: number) => n <= 8 || i === 0 || i === n - 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="chart">
      {chart === "bar" &&
        points.map((p, i) => {
          const barW = Math.max(2, (plotW / n) * 0.6);
          const cx = n === 1 ? PAD.left + plotW / 2 : PAD.left + (i / (n - 1)) * plotW;
          const top = Math.min(y(p.value), zeroY);
          const h = Math.max(1, Math.abs(zeroY - y(p.value)));
          return (
            <rect
              key={i}
              x={cx - barW / 2}
              y={top}
              width={barW}
              height={h}
              rx={2}
              fill={PALETTE[i % PALETTE.length]}
            >
              <title>{`${p.label}: ${niceValue(p.value, unit)}`}</title>
            </rect>
          );
        })}

      {(chart === "line" || chart === "area") && (
        <>
          {chart === "area" && (
            <path
              d={`M ${x(0)} ${zeroY} ${points.map((p, i) => `L ${x(i)} ${y(p.value)}`).join(" ")} L ${x(n - 1)} ${zeroY} Z`}
              fill={PALETTE[0]}
              fillOpacity={0.18}
            />
          )}
          <path
            d={points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`).join(" ")}
            fill="none"
            stroke={PALETTE[0]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill={PALETTE[0]}>
              <title>{`${p.label}: ${niceValue(p.value, unit)}`}</title>
            </circle>
          ))}
        </>
      )}

      {points.map((p, i) =>
        showLabel(i) ? (
          <text
            key={`l${i}`}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="fill-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {p.label.slice(0, 12)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function Pie({ points, unit }: { points: ChartPoint[]; unit?: string }) {
  const total = points.reduce((s, p) => s + p.value, 0);
  const r = 58;
  const cx = 70;
  const cy = 70;

  // A zero total would make every slice NaN — show nothing rather than a broken arc.
  if (total <= 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No data to chart</p>;
  }

  // Cumulative angles derived per slice rather than carried in a mutable
  // accumulator — reassigning across a render body is unsafe under concurrent
  // rendering, and n here is a handful of slices.
  const START = -Math.PI / 2; // 12 o'clock
  const slices = points.map((p, i) => {
    const frac = p.value / total;
    const preceding = points.slice(0, i).reduce((sum, q) => sum + q.value, 0);
    const start = START + (preceding / total) * Math.PI * 2;
    const end = start + frac * Math.PI * 2;
    const large = end - start > Math.PI ? 1 : 0;
    // A single slice covering the whole circle can't be drawn as an arc
    // (start === end), so render it as a full circle instead.
    const d =
      frac >= 0.999
        ? ""
        : `M ${cx} ${cy} L ${cx + r * Math.cos(start)} ${cy + r * Math.sin(start)} ` +
          `A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(end)} ${cy + r * Math.sin(end)} Z`;
    return { p, d, whole: frac >= 0.999, color: PALETTE[i % PALETTE.length], frac };
  });

  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 140 140" className="h-[120px] w-[120px] shrink-0" role="img" aria-label="pie chart">
        {slices.map((s, i) =>
          s.whole ? (
            <circle key={i} cx={cx} cy={cy} r={r} fill={s.color}>
              <title>{`${s.p.label}: ${niceValue(s.p.value, unit)}`}</title>
            </circle>
          ) : (
            <path key={i} d={s.d} fill={s.color}>
              <title>{`${s.p.label}: ${niceValue(s.p.value, unit)}`}</title>
            </path>
          ),
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-0.5 text-xs">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.p.label}</span>
            <span className="shrink-0 tabular-nums">{Math.round(s.frac * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WidgetChart({
  chart,
  points,
  title,
  unit,
}: {
  chart: ChartKind;
  points: ChartPoint[];
  title?: string;
  unit?: string;
}) {
  return (
    <div className="space-y-1">
      {title && <p className="text-xs font-medium">{title}</p>}
      {chart === "pie" ? <Pie points={points} unit={unit} /> : <XY chart={chart} points={points} unit={unit} />}
    </div>
  );
}
