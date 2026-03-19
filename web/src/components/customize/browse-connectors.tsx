"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useConnectorStore } from "@/stores/connector-store";
import { CONNECTOR_REGISTRY, CONNECTOR_MAP } from "@/lib/connectors/registry";
import { CATEGORY_LABELS } from "@/lib/nango-catalog";
import type { ConnectorDefinition } from "@/lib/connectors/types";
import { startOAuthFlow } from "@/lib/connectors/oauth";
import { provisionConnector, deprovisionConnector } from "@/lib/connectors/provisioner";
import { useMarketplace } from "@/lib/use-marketplace";
import { CONNECTOR_LOGOS } from "./connector-logos";
import { PluginRow } from "./plugin-row";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Search,
  Loader2,
  Cable,
  ChevronRight,
  Power,
  KeyRound,
  Unplug,
} from "lucide-react";

type CategoryFilter = "all" | ConnectorDefinition["category"];

export function BrowseConnectors() {
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  const connectorStates = useConnectorStore((s) => s.connectorStates);
  const tokens = useConnectorStore((s) => s.tokens);
  const setEnabled = useConnectorStore((s) => s.setEnabled);
  const setToken = useConnectorStore((s) => s.setToken);
  const clearToken = useConnectorStore((s) => s.clearToken);

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [awsError, setAwsError] = useState<string | null>(null);
  const [apiKeyDialog, setApiKeyDialog] = useState<{ connector: ConnectorDefinition; resolve: (key: string | null) => void } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  function promptApiKey(connector: ConnectorDefinition): Promise<string | null> {
    return new Promise((resolve) => {
      setApiKeyInput("");
      setApiKeyDialog({ connector, resolve });
    });
  }

  const { plugins: marketplacePlugins, loading: mpLoading } = useMarketplace();

  const categories = Array.from(
    new Set(CONNECTOR_REGISTRY.map((c) => c.category))
  ) as ConnectorDefinition["category"][];

  const filtered = CONNECTOR_REGISTRY.filter((c) => {
    const matchesSearch =
      !searchQuery ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      categoryFilter === "all" || c.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const marketplacePreview = marketplacePlugins.slice(0, 6);

  const handleConnect = useCallback(
    async (connector: ConnectorDefinition) => {
      if (connector.auth.type === 'api_key') {
        const key = await promptApiKey(connector);
        if (!key) return;

        setConnectingId(connector.id);
        try {
          setToken(connector.id, key);
          setEnabled(connector.id, true);
          await provisionConnector(connector, key);
        } catch (err) {
          console.error(`Failed to connect ${connector.id}:`, err);
          clearToken(connector.id);
        } finally {
          setConnectingId(null);
        }
        return;
      }

      if (connector.auth.type === 'aws_iam') {
        // Run `rqp auth` to authenticate via the nib CLI — opens browser SSO if needed
        setConnectingId(connector.id);
        try {
          const res = await fetch('/api/connectors/aws/auth', { method: 'POST' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'rqp auth failed');
          }
          setToken(connector.id, 'aws-iam');
          setEnabled(connector.id, true);
          await provisionConnector(connector, '');
        } catch (err) {
          console.error(`Failed to connect ${connector.id}:`, err);
          clearToken(connector.id);
          setAwsError(err instanceof Error ? err.message : 'AWS auth failed');
        } finally {
          setConnectingId(null);
        }
        return;
      }

      // OAuth2 flow
      setConnectingId(connector.id);
      try {
        const result = await startOAuthFlow(connector);
        setToken(connector.id, result.accessToken);
        setEnabled(connector.id, true);
        await provisionConnector(connector, result.accessToken);
      } catch (err) {
        console.error(`OAuth flow failed for ${connector.id}:`, err);
        // Don't clear token on cancel — user might retry
        if (err instanceof Error && !err.message.includes('canceled')) {
          clearToken(connector.id);
        }
      } finally {
        setConnectingId(null);
      }
    },
    [setToken, setEnabled, clearToken]
  );

  const handleToggle = useCallback(
    async (connector: ConnectorDefinition, currentlyEnabled: boolean) => {
      if (currentlyEnabled) {
        // Disable — remove from MCP
        setEnabled(connector.id, false);
        try {
          await deprovisionConnector(connector.id);
        } catch (err) {
          console.error(`Failed to deprovision ${connector.id}:`, err);
          setEnabled(connector.id, true); // rollback
        }
      } else {
        // Re-enable — add back to MCP (token still stored)
        const token = tokens[connector.id];
        if (!token) return; // shouldn't happen
        setEnabled(connector.id, true);
        try {
          await provisionConnector(connector, token);
        } catch (err) {
          console.error(`Failed to re-provision ${connector.id}:`, err);
          setEnabled(connector.id, false); // rollback
        }
      }
    },
    [setEnabled, tokens]
  );

  const handleDisconnect = useCallback(
    async (connectorId: string) => {
      setEnabled(connectorId, false);
      clearToken(connectorId);
      try {
        await deprovisionConnector(connectorId);
      } catch (err) {
        console.error(`Failed to deprovision ${connectorId}:`, err);
      }
    },
    [setEnabled, clearToken]
  );

  return (
    <>
    {/* AWS auth error dialog */}
    <Dialog open={!!awsError} onOpenChange={(open) => { if (!open) setAwsError(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>AWS Authentication Failed</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">{awsError}</p>
        <DialogFooter>
          <button
            onClick={() => setAwsError(null)}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            OK
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* API Key Input Dialog */}
    <Dialog
      open={!!apiKeyDialog}
      onOpenChange={(open) => {
        if (!open && apiKeyDialog) {
          apiKeyDialog.resolve(null);
          setApiKeyDialog(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => { e.preventDefault(); apiKeyInputRef.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>Connect {apiKeyDialog?.connector.name}</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          {apiKeyDialog?.connector.auth.hint && (
            <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2 leading-relaxed">
              {apiKeyDialog.connector.auth.hint}
            </p>
          )}
          <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            {apiKeyDialog?.connector.name} API token
          </label>
          <input
            ref={apiKeyInputRef}
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && apiKeyInput.trim() && apiKeyDialog) {
                apiKeyDialog.resolve(apiKeyInput.trim());
                setApiKeyDialog(null);
              }
            }}
            placeholder="Paste your token here"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
          />
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={() => { apiKeyDialog?.resolve(null); setApiKeyDialog(null); }}
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!apiKeyInput.trim()}
            onClick={() => {
              if (apiKeyDialog && apiKeyInput.trim()) {
                apiKeyDialog.resolve(apiKeyInput.trim());
                setApiKeyDialog(null);
              }
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Connect
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <button
          onClick={() => setCustomizeSection("connectors")}
          className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold">Connectors</h2>
          <p className="text-xs text-muted-foreground">
            Connect Claude to your apps, files, and services.
          </p>
        </div>
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 pl-8 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-border shrink-0 overflow-x-auto">
        <button
          onClick={() => setCategoryFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
            categoryFilter === "all"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              categoryFilter === cat
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-6 py-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Cable className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                No connectors match your search.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              {filtered.map((connector) => (
                <ConnectorRow
                  key={connector.id}
                  connector={connector}
                  state={connectorStates[connector.id]}
                  isConnecting={connectingId === connector.id}
                  onConnect={() => handleConnect(connector)}
                  onToggle={(enabled) => handleToggle(connector, enabled)}
                  onDisconnect={() => handleDisconnect(connector.id)}
                />
              ))}
            </div>
          )}

          {/* Official Plugins section */}
          {marketplacePreview.length > 0 && (
            <>
              <div className="flex items-center justify-between mt-8 mb-3">
                <h3 className="text-sm font-semibold">Official Plugins</h3>
                <button
                  onClick={() => setCustomizeSection("browse-marketplace")}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Browse all
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              {mpLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                  {marketplacePreview.map((plugin) => (
                    <PluginRow key={plugin.name} plugin={plugin} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function ConnectorRow({
  connector,
  state,
  isConnecting,
  onConnect,
  onToggle,
  onDisconnect,
}: {
  connector: ConnectorDefinition;
  state?: { enabled: boolean; authenticated: boolean };
  isConnecting: boolean;
  onConnect: () => void;
  onToggle: (currentlyEnabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const Logo = CONNECTOR_LOGOS[connector.id];
  const isAuthenticated = state?.authenticated ?? false;
  const isEnabled = state?.enabled ?? false;

  return (
    <div className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 hover:border-border/80 hover:bg-accent/30 transition-colors">
      {/* Logo */}
      <div className="shrink-0">
        {Logo ? (
          <Logo className="h-10 w-10 rounded-lg" />
        ) : (
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
            <Cable className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold leading-tight">{connector.name}</h3>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {connector.description}
        </p>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1.5">
        {connector.comingSoon ? (
          <span className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            Coming soon
          </span>
        ) : isConnecting ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Connecting
          </span>
        ) : !isAuthenticated ? (
          <button
            onClick={onConnect}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {connector.auth.type === 'api_key' ? (
              <KeyRound className="h-3 w-3" />
            ) : (
              <Power className="h-3 w-3" />
            )}
            Connect
          </button>
        ) : (
          <>
            {/* Toggle on/off */}
            <button
              onClick={() => onToggle(isEnabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                isEnabled ? "bg-green-500" : "bg-muted"
              }`}
              title={isEnabled ? "Disable" : "Enable"}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  isEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
                }`}
              />
            </button>
            {/* Disconnect button */}
            <button
              onClick={onDisconnect}
              className="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
              title="Disconnect"
            >
              <Unplug className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
