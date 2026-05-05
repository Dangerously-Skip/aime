"use client";

import { useState } from "react";
import type { ConversationROI, ConversationTokenUsage, ConversationEffortEstimate } from "@/stores/conversation-store";

interface RoiBadgeProps {
  roi: ConversationROI;
  tokenUsage?: ConversationTokenUsage;
  effortEstimate?: ConversationEffortEstimate;
  size?: "sm" | "xs";
}

export function RoiBadge({ roi, tokenUsage, effortEstimate, size = "sm" }: RoiBadgeProps) {
  const [showDollars, setShowDollars] = useState(false);

  const multiplier = roi.multiplier;
  const color = multiplier >= 5 ? "text-green-600 dark:text-green-400"
    : multiplier >= 2 ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";

  const textSize = size === "xs" ? "text-[10px]" : "text-xs";

  const tooltipParts: string[] = [];
  if (tokenUsage) {
    tooltipParts.push(`Cost: $${tokenUsage.cost.toFixed(4)}`);
    tooltipParts.push(`Tokens: ${tokenUsage.inputTokens}in / ${tokenUsage.outputTokens}out`);
  }
  if (effortEstimate) {
    tooltipParts.push(`Est. human: ${effortEstimate.hours}h (${effortEstimate.complexity})`);
    tooltipParts.push(`Task: ${effortEstimate.taskType}`);
  }
  tooltipParts.push(`ROI: ${multiplier.toFixed(1)}× faster`);
  tooltipParts.push(`Saved: $${roi.dollarsSaved.toFixed(0)}`);

  // Use a span (not a button) so this can be nested inside the conversation
  // list item button without breaking HTML semantics. Click still toggles via
  // role="button" + tabIndex for keyboard access.
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); setShowDollars((v) => !v); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          setShowDollars((v) => !v);
        }
      }}
      title={tooltipParts.join(" · ")}
      className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono font-semibold transition-colors hover:bg-muted/50 cursor-pointer ${color} ${textSize}`}
    >
      {showDollars ? (
        <span>${Math.abs(roi.dollarsSaved).toFixed(0)} saved</span>
      ) : (
        <>
          <span>▲</span>
          <span>{multiplier.toFixed(1)}×</span>
        </>
      )}
    </span>
  );
}
