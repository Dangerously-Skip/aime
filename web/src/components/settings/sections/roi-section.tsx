"use client";

import { useEffect, useState } from "react";
import { useConversationStore } from "@/stores/conversation-store";
import { ThumbsUp } from 'lucide-react'
import { useSettingsStore } from "@/stores/settings-store";
import { Input } from "@/components/ui/input";

/**
 * One way to write money in this section. It used to be three: `$0.0123`
 * (four places) in the cost table, `$12.34` for spend and `$12` for savings.
 * Sub-cent amounts keep enough precision to be non-zero.
 */
export function formatUsd(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(v);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

/**
 * The typed hourly rate, or null when it is not a usable number.
 *
 * `Number(value) || 150` snapped the field back to 150 the moment it was
 * cleared, so a rate could not be retyped from scratch. The draft is now kept
 * as typed and only a valid number is committed.
 */
export function parseHourlyRate(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 10000) return null;
  return n;
}

/** One row of `/api/settings/costs` — see lib/runs/spend.ts. */
interface SurfaceSpend {
  inputTokens: number
  outputTokens: number
  totalUsd: number
  runs: number
}

interface CostData {
  surfaces: Record<string, SurfaceSpend>
  total: SurfaceSpend
  runsConsidered: number
}

function isCostData(d: unknown): d is CostData {
  const c = d as Partial<CostData> | null
  return !!c && typeof c.surfaces === 'object' && c.surfaces !== null && typeof c.total?.totalUsd === 'number'
}

const tokens = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function RoiSection() {
  const conversations = useConversationStore((s) => s.conversations);
  const devHourlyRate = useSettingsStore((s) => s.devHourlyRate);
  const setDevHourlyRate = useSettingsStore((s) => s.setDevHourlyRate);
  const [rateDraft, setRateDraft] = useState<string | null>(null);

  /*
   * Spend comes from the RUN LOG — the provider-reported cost of every
   * recorded turn, on every surface. The table used to read cost trackers
   * nothing created (always $0.00), and "Total agent spend" summed each
   * conversation's `tokenUsage`, which only Cowork wrote and which held its
   * LAST turn, not a total.
   */
  const [costData, setCostData] = useState<CostData | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/settings/costs')
      .then((res) => {
        if (!res.ok) throw new Error('Could not load API costs')
        return res.json()
      })
      .then((data) => {
        if (!isCostData(data)) throw new Error('Could not load API costs')
        setCostData(data)
      })
      .catch((err) => setCostError(err instanceof Error ? err.message : 'Could not load API costs'))
  }, []);

  const totalHoursSaved = conversations.filter((c) => c.effortEstimate)
    .reduce((sum, c) => sum + (c.effortEstimate?.hours ?? 0), 0);
  const totalDollarsSaved = conversations.filter((c) => c.roi)
    .reduce((sum, c) => sum + (c.roi?.dollarsSaved ?? 0), 0);
  const roiConvs = conversations.filter((c) => c.roi);
  const avgMultiplier = roiConvs.length > 0
    ? roiConvs.reduce((sum, c) => sum + (c.roi?.multiplier ?? 0), 0) / roiConvs.length
    : 0;

  // Task type breakdown
  const taskTypeCounts: Record<string, number> = {};
  conversations.forEach((c) => {
    if (c.effortEstimate?.taskType) {
      taskTypeCounts[c.effortEstimate.taskType] = (taskTypeCounts[c.effortEstimate.taskType] || 0) + 1;
    }
  });
  const totalWithType = Object.values(taskTypeCounts).reduce((a, b) => a + b, 0);

  // Quality
  const abortedCount = conversations.filter((c) => c.sessionStats?.aborted).length;
  const abortRate = conversations.length > 0 ? Math.round((abortedCount / conversations.length) * 100) : 0;
  const ratedConvs = conversations.filter((c) => c.userRating !== undefined);
  const thumbsUpPct = ratedConvs.length > 0
    ? Math.round((ratedConvs.filter((c) => c.userRating === 1).length / ratedConvs.length) * 100)
    : null;

  const rateInvalid = rateDraft !== null && parseHourlyRate(rateDraft) === null;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-1">Usage & ROI</h3>
        <p className="text-xs text-muted-foreground">
          Spend is what the providers reported for your recent runs; time saved and ROI come from your conversations.
        </p>
      </div>

      {/* Dev hourly rate config */}
      <div className="space-y-2">
        <label htmlFor="roi-hourly-rate" className="block text-xs font-medium">
          Developer hourly rate (USD)
        </label>
        <Input
          id="roi-hourly-rate"
          type="number"
          inputMode="decimal"
          min={1}
          max={10000}
          value={rateDraft ?? String(devHourlyRate)}
          aria-invalid={rateInvalid || undefined}
          onChange={(e) => {
            setRateDraft(e.target.value);
            const n = parseHourlyRate(e.target.value);
            if (n !== null) setDevHourlyRate(n);
          }}
          // Leaving the field with nothing valid in it restores the saved rate
          // rather than inventing one.
          onBlur={() => setRateDraft(null)}
          className="h-8 w-32 text-xs"
        />
        <p className={`text-xs ${rateInvalid ? "text-destructive" : "text-muted-foreground"}`}>
          {rateInvalid ? "Enter a rate between 1 and 10,000." : "Used to calculate $ saved per session."}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Total agent spend"
          value={costData ? formatUsd(costData.total.totalUsd) : "—"}
          sub={costData ? `last ${costData.runsConsidered} runs` : undefined}
        />
        <StatCard label="Human hours saved" value={`~${totalHoursSaved.toFixed(0)}h`} />
        <StatCard label="Total saved" value={formatUsd(Math.max(0, totalDollarsSaved))} />
        <StatCard label="Avg ROI" value={avgMultiplier > 0 ? `${avgMultiplier.toFixed(1)}×` : "—"} />
      </div>

      {/* Quality */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Abort rate" value={`${abortRate}%`} sub={`${abortedCount} / ${conversations.length}`} />
        <StatCard
          label="Satisfaction"
          value={
            thumbsUpPct !== null ? (
              <span className="inline-flex items-center gap-1.5">
                {thumbsUpPct}%
                <ThumbsUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">thumbs up</span>
              </span>
            ) : (
              "—"
            )
          }
          sub={ratedConvs.length > 0 ? `${ratedConvs.length} rated` : "No ratings yet"}
        />
      </div>

      {/* API spend by surface */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium">API spend by surface</h4>
        {costError && <p className="text-xs text-destructive">{costError}</p>}
        {!costData && !costError && <p className="text-xs text-muted-foreground">Loading…</p>}
        {costData && costData.total.runs === 0 && (
          <p className="text-xs text-muted-foreground">No recorded spend yet — it appears here after your first turn.</p>
        )}
        {costData && costData.total.runs > 0 && (
          <table className="w-full rounded-md border text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="p-2 text-left font-medium">Surface</th>
                <th scope="col" className="p-2 text-right font-medium">Input tokens</th>
                <th scope="col" className="p-2 text-right font-medium">Output tokens</th>
                <th scope="col" className="p-2 text-right font-medium">Cost</th>
                <th scope="col" className="p-2 text-right font-medium">Runs</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(costData.surfaces)
                .sort((a, b) => b[1].totalUsd - a[1].totalUsd)
                .map(([name, cost]) => (
                  <tr key={name} className="border-b last:border-b-0">
                    <th scope="row" className="p-2 text-left font-normal capitalize">{name}</th>
                    <td className="p-2 text-right font-mono">{tokens.format(cost.inputTokens)}</td>
                    <td className="p-2 text-right font-mono">{tokens.format(cost.outputTokens)}</td>
                    <td className="p-2 text-right font-mono">{formatUsd(cost.totalUsd)}</td>
                    <td className="p-2 text-right font-mono">{cost.runs}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-medium">
                <th scope="row" colSpan={3} className="p-2 text-left">Total</th>
                <td className="p-2 text-right font-mono">{formatUsd(costData.total.totalUsd)}</td>
                <td className="p-2 text-right font-mono">{costData.total.runs}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Task type breakdown */}
      {totalWithType > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Task type breakdown</p>
          {Object.entries(taskTypeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <div key={type} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-muted-foreground">{type}</span>
                    <span>{Math.round((count / totalWithType) * 100)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{ width: `${(count / totalWithType) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-base font-semibold font-mono">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
