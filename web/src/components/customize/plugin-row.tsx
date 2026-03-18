"use client";

import type { MarketplacePlugin } from "@/lib/marketplace";
import { getPluginUrl, MARKETPLACE_CATEGORIES } from "@/lib/marketplace";
import {
  Code2,
  Briefcase,
  Database,
  Shield,
  Rocket,
  TestTube,
  Palette,
  GraduationCap,
  Activity,
  Puzzle,
  ExternalLink,
} from "lucide-react";

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  development: Code2,
  productivity: Briefcase,
  database: Database,
  security: Shield,
  deployment: Rocket,
  testing: TestTube,
  design: Palette,
  learning: GraduationCap,
  monitoring: Activity,
};

const CATEGORY_COLORS: Record<string, string> = {
  development: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  productivity: "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400",
  database: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
  security: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
  deployment: "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400",
  testing: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
  design: "bg-pink-100 text-pink-600 dark:bg-pink-900/40 dark:text-pink-400",
  learning: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400",
  monitoring: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-400",
};

interface PluginRowProps {
  plugin: MarketplacePlugin;
  compact?: boolean;
}

export function PluginRow({ plugin, compact }: PluginRowProps) {
  const category = plugin.category || "development";
  const Icon = CATEGORY_ICONS[category] || Puzzle;
  const colorClass = CATEGORY_COLORS[category] || "bg-muted text-muted-foreground";
  const url = getPluginUrl(plugin);
  const authorName = plugin.author?.name;
  const label = MARKETPLACE_CATEGORIES[category] || category;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 hover:border-border/80 hover:bg-accent/30 transition-colors"
    >
      {/* Category icon */}
      <div className={`shrink-0 flex items-center justify-center h-10 w-10 rounded-lg ${colorClass}`}>
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold leading-tight truncate">{plugin.name}</h3>
          {authorName && !compact && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              by {authorName}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {plugin.description}
        </p>
        {!compact && (
          <span className="inline-block mt-1 text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {label}
          </span>
        )}
      </div>

      {/* Action */}
      <div className="shrink-0">
        <span className="flex items-center justify-center h-8 w-8 rounded-full border border-border text-muted-foreground group-hover:bg-accent group-hover:text-foreground transition-colors">
          <ExternalLink className="h-3.5 w-3.5" />
        </span>
      </div>
    </a>
  );
}
