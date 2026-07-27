"use client";

import { useConversationStore } from "@/stores/conversation-store";
import { ThumbsUp } from 'lucide-react'
import { useSettingsStore } from "@/stores/settings-store";
import { Input } from "@/components/ui/input";

export function RoiSection() {
  const conversations = useConversationStore((s) => s.conversations);
  const devHourlyRate = useSettingsStore((s) => s.devHourlyRate);
  const setDevHourlyRate = useSettingsStore((s) => s.setDevHourlyRate);

  // Compute lifetime stats from all conversations
  const withMetrics = conversations.filter((c) => c.tokenUsage);
  const totalCost = withMetrics.reduce((sum, c) => sum + (c.tokenUsage?.cost ?? 0), 0);
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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-1">Usage & ROI</h3>
        <p className="text-xs text-muted-foreground">Lifetime stats computed from all your conversations.</p>
      </div>

      {/* Dev hourly rate config */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Developer hourly rate (USD)</label>
        <Input
          type="number"
          min={1}
          max={10000}
          value={devHourlyRate}
          onChange={(e) => setDevHourlyRate(Number(e.target.value) || 150)}
          className="h-8 w-32 text-xs"
        />
        <p className="text-xs text-muted-foreground">Used to calculate $ saved per session.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total agent spend" value={`$${totalCost.toFixed(2)}`} />
        <StatCard label="Human hours saved" value={`~${totalHoursSaved.toFixed(0)}h`} />
        <StatCard label="Total $ saved" value={`$${Math.max(0, totalDollarsSaved).toFixed(0)}`} />
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
