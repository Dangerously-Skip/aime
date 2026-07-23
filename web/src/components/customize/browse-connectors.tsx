"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { APP_NAME } from "@/config/branding";
import { useAppStore } from "@/stores/app-store";
import { useConnectorStore } from "@/stores/connector-store";
import { CONNECTOR_REGISTRY, CONNECTOR_MAP } from "@/lib/connectors/registry";
import { CATEGORY_LABELS } from "@/lib/nango-catalog";
import type { ConnectorDefinition } from "@/lib/connectors/types";
import { startOAuthFlow } from "@/lib/connectors/oauth";
import { runMcpOAuthFlow } from "@/lib/mcp/oauth-flow";
import { provisionConnector, deprovisionConnector } from "@/lib/connectors/provisioner";
import { sendFeatureAdoptionEvent } from "@/lib/telemetry/events";
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
  const setTokenMeta = useConnectorStore((s) => s.setTokenMeta);
  const clearToken = useConnectorStore((s) => s.clearToken);

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [awsError, setAwsError] = useState<string | null>(null);
  const [connectorError, setConnectorError] = useState<{ name: string; message: string } | null>(null);
  const [mcpSelfAuthNotice, setMcpSelfAuthNotice] = useState<{ name: string; hint: string } | null>(null);

  function reportConnectorError(connector: ConnectorDefinition, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Don't surface cancellations — the user knowingly closed the auth window.
    if (message.toLowerCase().includes('cancel')) return;
    setConnectorError({ name: connector.name, message });
  }
  const [apiKeyDialog, setApiKeyDialog] = useState<{
    connector: ConnectorDefinition;
    resolve: (key: string | null) => void;
    title?: string;
    label?: string;
    placeholder?: string;
    inputType?: string;
    buttonText?: string;
  } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  function promptApiKey(connector: ConnectorDefinition): Promise<string | null> {
    return new Promise((resolve) => {
      setApiKeyInput("");
      setApiKeyDialog({ connector, resolve });
    });
  }

  function promptText(
    connector: ConnectorDefinition,
    opts: { title?: string; label?: string; placeholder?: string; inputType?: string; buttonText?: string }
  ): Promise<string | null> {
    return new Promise((resolve) => {
      setApiKeyInput("");
      setApiKeyDialog({ connector, resolve, ...opts });
    });
  }

  const { plugins: marketplacePlugins, loading: mpLoading } = useMarketplace();

  // Hydrate connector state from the provisioned MCP config on mount. This reflects
  // MCPs connected via the marketplace (plugin install) or external means.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/connectors/hydrate")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.connectedIds) return;
        for (const id of data.connectedIds as string[]) {
          // Only mark as connected if we have a corresponding connector registry entry
          if (CONNECTOR_MAP[id]) {
            // Use a sentinel token so UI shows it as authenticated without leaking real tokens
            setToken(id, "provisioned");
            setEnabled(id, true);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setToken, setEnabled]);

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
      // Snowflake: custom PAT + per-user URL flow
      if (connector.id === 'snowflake') {
        setConnectingId(connector.id);
        try {
          // Step 1: show setup SQL so user can create MCP server + PAT
          const setupHint =
            'One-time setup — run in Snowsight (any role you have create privileges in):\n\n' +
            '-- 1. Create an MCP server exposing raw SQL:\n' +
            'CREATE DATABASE IF NOT EXISTS AIME_MCP;\n' +
            'CREATE SCHEMA IF NOT EXISTS AIME_MCP.MCP;\n' +
            'CREATE OR REPLACE MCP SERVER AIME_MCP.MCP.aime FROM SPECIFICATION $$\n' +
            'tools:\n' +
            '  - name: "run_sql"\n' +
            '    type: "SYSTEM_EXECUTE_SQL"\n' +
            '    title: "Run SQL"\n' +
            '    description: "Execute arbitrary SQL."\n' +
            '$$;\n\n' +
            '-- 2. Generate a PAT (replace ROLE with your preferred role, e.g. ANALYST):\n' +
            'ALTER USER IF EXISTS CURRENT_USER() ADD PROGRAMMATIC ACCESS TOKEN aime_mcp\n' +
            "  ROLE_RESTRICTION = 'ANALYST' DAYS_TO_EXPIRY = 90;\n\n" +
            '-- Copy token_secret from the output — you\'ll paste it on the next screen.';

          const mcpUrl = await promptText(
            { ...connector, auth: { ...connector.auth, hint: setupHint } } as ConnectorDefinition,
            {
              title: 'Connect Snowflake',
              label: 'MCP server URL',
              placeholder: 'https://ZY31549-LY01550.snowflakecomputing.com/api/v2/databases/AIME_MCP/schemas/MCP/mcp-servers/aime',
              inputType: 'text',
              buttonText: 'Next',
            }
          );
          if (!mcpUrl) {
            setConnectingId(null);
            return;
          }

          const pat = await promptText(
            {
              ...connector,
              auth: { ...connector.auth, hint: 'Paste the token_secret from the ALTER USER ... ADD PROGRAMMATIC ACCESS TOKEN statement.' },
            } as ConnectorDefinition,
            {
              title: 'Connect Snowflake',
              label: 'Programmatic Access Token',
              placeholder: 'Paste token_secret here',
              inputType: 'password',
              buttonText: 'Connect',
            }
          );
          if (!pat) {
            setConnectingId(null);
            return;
          }

          // Provision MCP entry directly with the user's URL + PAT
          await fetch('/api/connectors/provision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectorId: connector.id,
              connectorName: connector.name,
              mcpEntry: {
                transport: 'streamable-http',
                url: mcpUrl,
                headers: { Authorization: `Bearer ${pat}` },
              },
            }),
          });

          setToken(connector.id, pat);
          setEnabled(connector.id, true);
          sendFeatureAdoptionEvent({ feature: `connector:${connector.id}` });
        } catch (err) {
          console.error(`Snowflake connect failed:`, err);
          clearToken(connector.id);
        } finally {
          setConnectingId(null);
        }
        return;
      }

      if (connector.auth.type === 'api_key') {
        const key = await promptApiKey(connector);
        if (!key) return;

        setConnectingId(connector.id);
        try {
          setToken(connector.id, key);
          setEnabled(connector.id, true);
          await provisionConnector(connector, key);
          sendFeatureAdoptionEvent({ feature: `connector:${connector.id}` });
        } catch (err) {
          console.error(`Failed to connect ${connector.id}:`, err);
          clearToken(connector.id);
          reportConnectorError(connector, err);
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
          sendFeatureAdoptionEvent({ feature: `connector:${connector.id}` });
        } catch (err) {
          console.error(`Failed to connect ${connector.id}:`, err);
          clearToken(connector.id);
          setAwsError(err instanceof Error ? err.message : 'AWS auth failed');
        } finally {
          setConnectingId(null);
        }
        return;
      }

      // MCP self-auth — the MCP server handles its own auth flow (e.g. device code).
      // We just provision it; the user authenticates via the MCP's own tools
      // (e.g. calling "login" in chat) on first use.
      if (connector.auth.type === 'mcp-self-auth') {
        setConnectingId(connector.id);
        try {
          setToken(connector.id, 'mcp-self-auth');
          setEnabled(connector.id, true);
          await provisionConnector(connector, '');
          sendFeatureAdoptionEvent({ feature: `connector:${connector.id}` });
          // Surface clear next steps — the user expects an OAuth popup but
          // this flow defers auth to first tool use in chat.
          setMcpSelfAuthNotice({
            name: connector.name,
            hint: connector.auth.hint || `Next: open a chat and ask ${APP_NAME} to use this service. You'll be prompted to sign in the first time it needs access.`,
          });
        } catch (err) {
          console.error(`mcp-self-auth provision failed for ${connector.id}:`, err);
          clearToken(connector.id);
          reportConnectorError(connector, err);
        } finally {
          setConnectingId(null);
        }
        return;
      }

      // MCP OAuth 2.1 flow — zero-config via Dynamic Client Registration
      if (connector.auth.type === 'mcp-oauth') {
        if (!connector.auth.mcpUrl) {
          console.error(`Connector ${connector.id} is mcp-oauth but missing mcpUrl`);
          return;
        }
        setConnectingId(connector.id);
        try {
          let resolvedUrl = connector.auth.mcpUrl;

          // Snowflake: prompt for account, database, schema, server name
          if (resolvedUrl.includes('{account}')) {
            const fields: Array<{
              key: string;
              label: string;
              placeholder: string;
              hint: string;
            }> = [
              { key: 'account', label: 'Account identifier', placeholder: 'ORG-ACCOUNT', hint: 'Find this in Snowflake → Account → Account Details → "Account identifier" (e.g. ZY31549-LY01550).' },
              { key: 'database', label: 'Database', placeholder: 'MY_DB', hint: 'Snowflake database containing your MCP server.' },
              { key: 'schema', label: 'Schema', placeholder: 'PUBLIC', hint: 'Schema containing your MCP server.' },
              { key: 'server', label: 'MCP server name', placeholder: 'MY_MCP_SERVER', hint: 'Name of the MCP server you created in Snowflake (CREATE MCP SERVER ...).' },
            ];
            for (const f of fields) {
              const value = await promptText(
                { ...connector, auth: { ...connector.auth, hint: f.hint } } as ConnectorDefinition,
                {
                  title: `Connect ${connector.name}`,
                  label: f.label,
                  placeholder: f.placeholder,
                  inputType: 'text',
                  buttonText: 'Continue',
                }
              );
              if (!value) {
                setConnectingId(null);
                return;
              }
              resolvedUrl = resolvedUrl.replace(`{${f.key}}`, encodeURIComponent(value));
            }
          }

          // If the URL contains {tenant_id}, resolve it from the user's email domain
          if (resolvedUrl.includes('{tenant_id}')) {
            const email = await promptText(
              {
                ...connector,
                auth: {
                  ...connector.auth,
                  hint: 'We need your work email to find the right Microsoft 365 tenant. Nothing is sent to Microsoft yet — this just discovers your tenant ID.',
                },
              } as ConnectorDefinition,
              {
                title: `Connect ${connector.name}`,
                label: 'Work email',
                placeholder: 'you@company.com',
                inputType: 'email',
                buttonText: 'Continue',
              }
            );
            if (!email) {
              setConnectingId(null);
              return;
            }
            const domain = email.includes('@') ? email.split('@')[1] : email;
            const tenantRes = await fetch('/api/mcp/resolve-tenant', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ domain }),
            });
            if (!tenantRes.ok) {
              const err = await tenantRes.json().catch(() => ({}));
              throw new Error(err.error || `Couldn't find Azure tenant for ${domain}`);
            }
            const { tenantId } = await tenantRes.json();
            resolvedUrl = resolvedUrl.replace('{tenant_id}', tenantId);
          }

          let result;
          try {
            result = await runMcpOAuthFlow(connector.id, resolvedUrl, {
              fallbackClientId: connector.auth.fallbackClientId,
              fallbackClientIdEnv: connector.auth.fallbackClientIdEnv,
            });
          } catch (err) {
            // Friendlier error for MCPs that require a pre-registered app via env var
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('Dynamic Client Registration') && connector.auth.fallbackClientIdEnv) {
              throw new Error(
                `${connector.name} requires a pre-registered Azure AD app. ` +
                `Ask IT to register an app (redirect URI: http://localhost:3000/api/connectors/oauth/callback) ` +
                `and set ${connector.auth.fallbackClientIdEnv} in the ${APP_NAME} config.`
              );
            }
            throw err;
          }
          const expiresAt = result.expiresIn
            ? Date.now() + result.expiresIn * 1000
            : undefined;
          // The /api/mcp/oauth/exchange endpoint already wrote to the provisioned MCP config
          // as `nib-mcp-<id>`. We store token metadata in the client store too so
          // the UI reflects authenticated state.
          setTokenMeta(connector.id, {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt,
          });
          setEnabled(connector.id, true);
          sendFeatureAdoptionEvent({ feature: `connector:${connector.id}` });
        } catch (err) {
          console.error(`MCP OAuth failed for ${connector.id}:`, err);
          if (err instanceof Error && !err.message.includes('canceled')) {
            clearToken(connector.id);
          }
          reportConnectorError(connector, err);
        } finally {
          setConnectingId(null);
        }
        return;
      }

      // OAuth2 flow
      // For byoCredentials connectors: prompt for client_id + client_secret
      // (once — we persist them) before kicking off the OAuth dance.
      let byoCreds: { clientId: string; clientSecret: string } | undefined;
      if (connector.auth.byoCredentials) {
        let existing = useConnectorStore.getState().getOAuthClientCreds(connector.id);
        if (!existing) {
          const newClientId = await promptText(connector, {
            title: `Connect ${connector.name}`,
            label: 'OAuth Client ID',
            placeholder: '...apps.googleusercontent.com',
            inputType: 'text',
            buttonText: 'Next',
          });
          if (!newClientId) return;
          const newClientSecret = await promptText(connector, {
            title: `Connect ${connector.name}`,
            label: 'OAuth Client Secret',
            placeholder: 'GOCSPX-...',
            inputType: 'password',
            buttonText: 'Continue',
          });
          if (!newClientSecret) return;
          useConnectorStore.getState().setOAuthClientCreds(connector.id, {
            clientId: newClientId,
            clientSecret: newClientSecret,
          });
          existing = { clientId: newClientId, clientSecret: newClientSecret };
        }
        byoCreds = existing;
      }

      setConnectingId(connector.id);
      try {
        const result = await startOAuthFlow(connector, byoCreds);
        const expiresAt = result.expiresIn
          ? Date.now() + result.expiresIn * 1000
          : undefined;
        setTokenMeta(connector.id, {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt,
        });
        setEnabled(connector.id, true);
        await provisionConnector(connector, result.accessToken, {
          refreshToken: result.refreshToken,
          expiresAt,
          // Persist user-supplied OAuth creds so server-side refresh works
          // without the browser later.
          ...(byoCreds && connector.auth.tokenUrl
            ? {
                oauthClientId: byoCreds.clientId,
                oauthClientSecret: byoCreds.clientSecret,
                oauthTokenEndpoint: connector.auth.tokenUrl,
              }
            : {}),
        });
        sendFeatureAdoptionEvent({ feature: `connector:${connector.id}` });
      } catch (err) {
        console.error(`OAuth flow failed for ${connector.id}:`, err);
        // Don't clear token on cancel — user might retry
        if (err instanceof Error && !err.message.includes('canceled')) {
          clearToken(connector.id);
        }
        reportConnectorError(connector, err);
      } finally {
        setConnectingId(null);
      }
    },
    [setToken, setEnabled, clearToken]
  );

  const handleToggle = useCallback(
    async (connector: ConnectorDefinition, currentlyEnabled: boolean) => {
      // For mcp-oauth connectors the toggle doesn't round-trip cleanly —
      // re-enabling would require re-running the OAuth flow. Treat "disable"
      // as a full disconnect.
      if (connector.auth.type === 'mcp-oauth') {
        if (currentlyEnabled) {
          setEnabled(connector.id, false);
          clearToken(connector.id);
          try {
            await fetch('/api/mcp/uninstall', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: connector.id }),
            });
          } catch (err) {
            console.error(`Failed to uninstall MCP for ${connector.id}:`, err);
          }
        }
        return;
      }

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
    [setEnabled, clearToken, tokens]
  );

  const handleDisconnect = useCallback(
    async (connectorId: string) => {
      const token = tokens[connectorId];
      const connector = CONNECTOR_MAP[connectorId];
      setEnabled(connectorId, false);
      clearToken(connectorId);

      // For mcp-oauth connectors, the entry is written as `nib-mcp-<id>` by the
      // exchange endpoint. Use the MCP uninstall path which cleans up both the
      // MCP config entry and the stored DCR registration.
      if (connector?.auth.type === 'mcp-oauth') {
        try {
          await fetch('/api/mcp/uninstall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: connectorId }),
          });
        } catch (err) {
          console.error(`Failed to uninstall MCP for ${connectorId}:`, err);
        }
        return;
      }

      try {
        await deprovisionConnector(connectorId);
      } catch (err) {
        console.error(`Failed to deprovision ${connectorId}:`, err);
      }
      // Revoke the OAuth token with the provider so reconnecting triggers
      // a fresh authorization flow (with updated scopes if changed)
      if (token) {
        fetch('/api/connectors/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectorId, token }),
        }).catch((err) => console.warn(`Token revocation failed for ${connectorId}:`, err));
      }
    },
    [setEnabled, clearToken, tokens]
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

    {/* Generic connector error dialog */}
    <Dialog open={!!connectorError} onOpenChange={(open) => { if (!open) setConnectorError(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Couldn&apos;t connect {connectorError?.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2 whitespace-pre-wrap leading-relaxed">{connectorError?.message}</p>
        <DialogFooter>
          <button
            onClick={() => setConnectorError(null)}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            OK
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* MCP self-auth notice */}
    <Dialog open={!!mcpSelfAuthNotice} onOpenChange={(open) => { if (!open) setMcpSelfAuthNotice(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mcpSelfAuthNotice?.name} connected</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2 leading-relaxed">
          {mcpSelfAuthNotice?.hint}
        </p>
        <DialogFooter>
          <button
            onClick={() => setMcpSelfAuthNotice(null)}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Got it
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {apiKeyDialog?.title || `Connect ${apiKeyDialog?.connector.name}`}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          {apiKeyDialog?.connector.auth.hint && (
            <pre className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2 leading-relaxed whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
              {apiKeyDialog.connector.auth.hint}
            </pre>
          )}
          <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            {apiKeyDialog?.label || `${apiKeyDialog?.connector.name} API token`}
          </label>
          <input
            ref={apiKeyInputRef}
            type={apiKeyDialog?.inputType || "password"}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && apiKeyInput.trim() && apiKeyDialog) {
                apiKeyDialog.resolve(apiKeyInput.trim());
                setApiKeyDialog(null);
              }
            }}
            placeholder={apiKeyDialog?.placeholder || "Paste your token here"}
            className={`flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${apiKeyDialog?.inputType === 'email' ? '' : 'font-mono'}`}
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
            {apiKeyDialog?.buttonText || 'Connect'}
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
