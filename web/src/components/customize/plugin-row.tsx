"use client";

import { useState, useCallback } from "react";
import type { MarketplacePlugin } from "@/lib/marketplace";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplace";
import { runMcpOAuthFlow } from "@/lib/mcp/oauth-flow";
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
  Check,
  Loader2,
  Trash2,
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
  /** Called after install/uninstall to trigger a re-fetch of installed state. */
  onStateChange?: () => void;
  /** Installation state from the parent. */
  installedState?: {
    installed: boolean;
    authenticated: boolean;
    hasMcpOAuth: boolean;
  };
}

export function PluginRow({ plugin, compact, onStateChange, installedState }: PluginRowProps) {
  const category = plugin.category || "development";
  const Icon = CATEGORY_ICONS[category] || Puzzle;
  const colorClass = CATEGORY_COLORS[category] || "bg-muted text-muted-foreground";
  const authorName = plugin.author?.name;
  const label = MARKETPLACE_CATEGORIES[category] || category;

  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const installed = installedState?.installed ?? false;
  const authenticated = installedState?.authenticated ?? false;
  const needsAuth = installedState?.hasMcpOAuth ?? false;

  const handleInstall = useCallback(async () => {
    setWorking(true);
    setError(null);
    try {
      // Step 1: git clone + read manifest
      const installRes = await fetch("/api/mcp/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: plugin.name, source: plugin.source }),
      });
      if (!installRes.ok) {
        const err = await installRes.json().catch(() => ({}));
        throw new Error(err.error || `Install failed: ${installRes.status}`);
      }
      const { manifest } = await installRes.json();

      // Step 2: Check if the plugin has an HTTP/SSE MCP server that needs OAuth
      const needsOAuth = Object.values(manifest?.mcpServers || {}).some(
        (s: unknown) =>
          typeof s === "object" &&
          s !== null &&
          (s as { url?: string }).url
      );

      if (needsOAuth) {
        // Step 3: Run the OAuth flow
        await runMcpOAuthFlow(plugin.name);
      }

      onStateChange?.();
    } catch (err) {
      console.error(`[Plugin Install] Failed for ${plugin.name}:`, err);
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setWorking(false);
    }
  }, [plugin, onStateChange]);

  const handleUninstall = useCallback(async () => {
    if (!confirm(`Uninstall ${plugin.name}? This will remove its plugin files and revoke any OAuth tokens.`)) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: plugin.name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Uninstall failed");
      }
      onStateChange?.();
    } catch (err) {
      console.error(`[Plugin Uninstall] Failed for ${plugin.name}:`, err);
      setError(err instanceof Error ? err.message : "Uninstall failed");
    } finally {
      setWorking(false);
    }
  }, [plugin, onStateChange]);

  const handleReauth = useCallback(async () => {
    setWorking(true);
    setError(null);
    try {
      await runMcpOAuthFlow(plugin.name);
      onStateChange?.();
    } catch (err) {
      console.error(`[Plugin Reauth] Failed for ${plugin.name}:`, err);
      setError(err instanceof Error ? err.message : "Reauth failed");
    } finally {
      setWorking(false);
    }
  }, [plugin, onStateChange]);

  return (
    <div className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 hover:border-border/80 hover:bg-accent/30 transition-colors">
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
          {error || plugin.description}
        </p>
        {!compact && !error && (
          <span className="inline-block mt-1 text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {label}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1.5">
        {working ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Working
          </span>
        ) : installed ? (
          <>
            {needsAuth && !authenticated && (
              <button
                onClick={handleReauth}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Sign in
              </button>
            )}
            {needsAuth && authenticated && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 px-3 py-1.5 text-[11px] font-medium">
                <Check className="h-3 w-3" />
                Connected
              </span>
            )}
            {!needsAuth && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                <Check className="h-3 w-3" />
                Installed
              </span>
            )}
            <button
              onClick={handleUninstall}
              className="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
              title="Uninstall"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button
            onClick={handleInstall}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Install
          </button>
        )}
      </div>
    </div>
  );
}
