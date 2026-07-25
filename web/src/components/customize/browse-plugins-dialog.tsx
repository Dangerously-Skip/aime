"use client";

import { useEffect, useState } from "react";
import { Loader2, Puzzle, Zap, Bot, Webhook, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PluginData {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  path: string;
  skillCount: number;
  agentCount: number;
  hasHooks: boolean;
  hasMcp: boolean;
}

interface BrowsePluginsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BrowsePluginsDialog({ open, onOpenChange }: BrowsePluginsDialogProps) {
  const [plugins, setPlugins] = useState<PluginData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginData | null>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- spinner for the fetch this effect starts; nothing to derive during render
      setLoading(true);
      fetch("/api/customize/plugins")
        .then((r) => r.json())
        .then((data) => setPlugins(data.plugins || []))
        .catch(() => setPlugins([]))
        .finally(() => setLoading(false));
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-3xl max-h-[80vh] rounded-xl border border-border bg-background shadow-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Puzzle className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Plugins</h2>
          </div>
          <button onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : selectedPlugin ? (
            <PluginDetail
              plugin={selectedPlugin}
              onBack={() => setSelectedPlugin(null)}
            />
          ) : plugins.length === 0 ? (
            <div className="text-center py-12">
              <Puzzle className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <h3 className="text-sm font-medium mb-1">No plugins installed</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Plugins live in{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">~/.claude/plugins/</code>.
                Each plugin is a directory containing skills, agents, hooks, and/or MCP servers.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {plugins.map((plugin) => (
                <button
                  key={plugin.id}
                  onClick={() => setSelectedPlugin(plugin)}
                  className="text-left rounded-lg border border-border p-4 hover:border-primary/30 hover:shadow-sm transition-all space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <Puzzle className="h-4 w-4 text-primary shrink-0" />
                    <h3 className="text-sm font-semibold truncate">{plugin.name}</h3>
                    <span className="text-[10px] text-muted-foreground">v{plugin.version}</span>
                  </div>
                  {plugin.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {plugin.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    {plugin.skillCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Zap className="h-3 w-3" />
                        {plugin.skillCount} skill{plugin.skillCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {plugin.agentCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Bot className="h-3 w-3" />
                        {plugin.agentCount} agent{plugin.agentCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {plugin.hasMcp && (
                      <span className="flex items-center gap-1">
                        <Webhook className="h-3 w-3" />
                        MCP
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PluginDetail({
  plugin,
  onBack,
}: {
  plugin: PluginData;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
        Back to plugins
      </Button>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Puzzle className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{plugin.name}</h2>
          <span className="text-xs text-muted-foreground">v{plugin.version}</span>
        </div>
        {plugin.description && (
          <p className="text-sm text-muted-foreground">{plugin.description}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Author: {plugin.author}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Zap} label="Skills" count={plugin.skillCount} />
        <StatCard icon={Bot} label="Agents" count={plugin.agentCount} />
        <StatCard
          icon={Webhook}
          label="MCP"
          count={plugin.hasMcp ? 1 : 0}
        />
        <StatCard
          icon={Puzzle}
          label="Hooks"
          count={plugin.hasHooks ? 1 : 0}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Location</h3>
        <code className="text-xs bg-muted px-2 py-1 rounded block">
          {plugin.path}
        </code>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
      <div className="text-lg font-semibold">{count}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
