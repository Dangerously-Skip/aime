"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMarketplace } from "@/lib/use-marketplace";
import { PluginRow } from "./plugin-row";
import { Cable, Trash2, RefreshCw, Loader2, Plus, Globe, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddConnectorDialog } from "./add-connector-dialog";

interface ConnectorConfig {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  disabled?: boolean;
}

interface ConnectorData {
  id: string;
  name: string;
  type: string;
  config: ConnectorConfig;
  source: 'mcp_json';
  disabled: boolean;
}

interface ConnectorDetailProps {
  connectorId: string | null;
}

const CONNECTOR_CATEGORIES = ['development', 'database', 'deployment'];

export function ConnectorDetail({ connectorId }: ConnectorDetailProps) {
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  const [connector, setConnector] = useState<ConnectorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Marketplace plugins for empty state
  const { plugins: marketplacePlugins } = useMarketplace();
  const mcpPlugins = marketplacePlugins
    .filter((p) => CONNECTOR_CATEGORIES.includes(p.category || ''))
    .slice(0, 5);

  const fetchConnector = useCallback((id: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/customize/connectors/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Connector not found");
        return r.json();
      })
      .then((data) => setConnector(data.connector))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (connectorId) {
      fetchConnector(connectorId);
    } else {
      setConnector(null);
    }
  }, [connectorId, fetchConnector]);

  async function handleDelete() {
    if (!connector) return;
    if (!confirm(`Remove connector "${connector.name}"? This removes it from ~/.claude/.mcp.json.`)) return;
    await fetch(`/api/customize/connectors/${encodeURIComponent(connector.id)}`, { method: "DELETE" });
    setConnector(null);
  }

  async function handleToggle() {
    if (!connector) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/customize/connectors/${encodeURIComponent(connector.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: !connector.disabled }),
      });
      if (res.ok) {
        const data = await res.json();
        setConnector(data.connector);
      }
    } finally {
      setToggling(false);
    }
  }

  function handleConnectorAdded() {
    setShowAddDialog(false);
  }

  // Empty state
  if (!connectorId) {
    return (
      <div className="flex flex-1 flex-col items-center p-8 text-center overflow-y-auto min-h-0 pt-16">
        <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 text-primary mb-4">
          <Cable className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">Connectors</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Connectors are MCP servers defined in{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">~/.claude/.mcp.json</code>.
          Select a connector from the sidebar or add a new one.
        </p>
        <div className="flex items-center gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddDialog(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add MCP connector
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setCustomizeSection("browse-connectors")}
          >
            <Globe className="h-3.5 w-3.5 mr-1.5" />
            Browse OAuth connectors
          </Button>
        </div>

        {/* Marketplace MCP plugins */}
        {mcpPlugins.length > 0 && (
          <div className="w-full max-w-xl mt-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-left">MCP Servers from Marketplace</h3>
              <button
                onClick={() => setCustomizeSection("browse-marketplace")}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View all
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-2">
              {mcpPlugins.map((plugin) => (
                <PluginRow key={plugin.name} plugin={plugin} compact />
              ))}
            </div>
          </div>
        )}

        <AddConnectorDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          onSuccess={handleConnectorAdded}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !connector) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {error || "Connector not found"}
      </div>
    );
  }

  const config = connector.config;

  return (
    <div className="flex flex-1 flex-col p-6 max-w-2xl mx-auto w-full overflow-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Cable className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">{connector.name}</h2>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                connector.disabled
                  ? "bg-muted text-muted-foreground"
                  : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              }`}
            >
              {connector.disabled ? "Disabled" : "Enabled"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {connector.type.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Toggle & actions */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={handleToggle}
          disabled={toggling}
        >
          {toggling && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          {connector.disabled ? "Enable" : "Disable"}
        </Button>
        <Button variant="outline" size="sm" disabled>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Reconnect
        </Button>
      </div>

      {/* Configuration */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Configuration</h3>
        <div className="rounded-lg border border-border divide-y divide-border">
          {config.type === "stdio" && (
            <>
              <ConfigRow label="Command" value={config.command || "-"} mono />
              {config.args && config.args.length > 0 && (
                <ConfigRow label="Arguments" value={config.args.join(" ")} mono />
              )}
            </>
          )}
          {(config.type === "http" || config.type === "sse") && (
            <ConfigRow label="URL" value={config.url || "-"} mono />
          )}
          {config.headers && Object.keys(config.headers).length > 0 && (
            <ConfigRow
              label="Headers"
              value={Object.entries(config.headers)
                .map(([k, v]) => `${k}: ${v.length > 20 ? v.slice(0, 8) + "..." : v}`)
                .join(", ")}
            />
          )}
          {config.env && Object.keys(config.env).length > 0 && (
            <ConfigRow
              label="Env vars"
              value={Object.keys(config.env).join(", ")}
            />
          )}
        </div>
      </div>

      <AddConnectorDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={handleConnectorAdded}
      />
    </div>
  );
}

function ConfigRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 px-3 py-2.5">
      <span className="text-xs font-medium text-muted-foreground w-20 shrink-0">
        {label}
      </span>
      <span className={`text-xs text-foreground ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}
