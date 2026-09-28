"use client";

import { useState, useCallback, useEffect } from "react";
import { useConnectorStore } from "@/stores/connector-store";
import { startOAuthFlow } from "@/lib/connectors/oauth";
import { provisionConnector } from "@/lib/connectors/provisioner";
import { connectConnector } from "@/lib/connectors/connect";
import { runMcpOAuthFlow } from "@/lib/mcp/oauth-flow";
import type { ConnectorDefinition } from "@/lib/connectors/types";
import { Input } from "@/components/ui/input";
import {
  GitHubLogo,
  AtlassianLogo,
  M365GraphLogo,
  MiroLogo,
  BuildkiteLogo,
} from "@/components/customize/connector-logos";
import { ArrowLeft, Check, Loader2, Power } from "lucide-react";

interface FeaturedConnector {
  id: string;
  name: string;
  description: string;
  Logo: (props: { className?: string }) => React.ReactElement;
  /** A caveat worth knowing BEFORE clicking Connect. */
  note?: string;
}

/**
 * Featured connectors for onboarding — the five that work end-to-end.
 *
 * Microsoft 365 connects through Microsoft's own public "Graph PowerShell"
 * client, which only accepts work or school accounts and which some tenants
 * block until an admin approves it. It stays featured (nothing to configure for
 * those who can use it), but says so up front instead of failing after sign-in.
 */
export const FEATURED_CONNECTORS: FeaturedConnector[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repositories, PRs, and issues",
    Logo: GitHubLogo,
  },
  {
    id: "atlassian",
    name: "Atlassian",
    description: "Jira + Confluence — issue tracking and wiki",
    Logo: AtlassianLogo,
  },
  {
    id: "m365-graph",
    name: "Microsoft 365 (Mail + Calendar)",
    description: "Read/send email and manage calendar via Graph",
    Logo: M365GraphLogo,
    note: "Work or school accounts only; some organisations require admin approval.",
  },
  {
    id: "miro",
    name: "Miro",
    description: "Visual collaboration & whiteboarding",
    Logo: MiroLogo,
  },
  {
    id: "buildkite",
    name: "Buildkite",
    description: "CI/CD pipelines & builds",
    Logo: BuildkiteLogo,
  },
];

/** "m365-graph" → "Microsoft 365 (Mail + Calendar)"; unknown ids are title-cased. */
export function connectorDisplayName(id: string): string {
  const featured = FEATURED_CONNECTORS.find((c) => c.id === id);
  if (featured) return featured.name;
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Can this server actually run the OAuth flow for a connector?
 *
 * An oauth2 connector needs a client id the server holds (env, or a built-in
 * public client). Without one the flow fails only after the user has clicked
 * Connect — so ask first, and show "needs an app registration" instead of a
 * button that cannot work. Other auth types (API key, MCP OAuth) need nothing
 * from the server and are always offered.
 */
export async function serverCanOffer(
  connectorId: string,
  auth: { type: string; byoCredentials?: unknown },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (auth.type !== "oauth2") return true;
  // The user brings the OAuth app; the flow asks for it.
  if (auth.byoCredentials) return true;
  try {
    const res = await fetchImpl(
      `/api/connectors/oauth/config?connectorId=${encodeURIComponent(connectorId)}`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

interface StepConnectorsProps {
  onConnectorConnected: (connectorId: string) => void;
  onContinue: () => void;
  onBack: () => void;
}

export function StepConnectors({
  onConnectorConnected,
  onContinue,
  onBack,
}: StepConnectorsProps) {
  const connectorStates = useConnectorStore((s) => s.connectorStates);
  const setToken = useConnectorStore((s) => s.setToken);
  const setEnabled = useConnectorStore((s) => s.setEnabled);
  const clearToken = useConnectorStore((s) => s.clearToken);

  /** Connectors this server cannot run a sign-in for (see `serverCanOffer`). */
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { CONNECTOR_MAP } = await import("@/lib/connectors/registry");
      const results = await Promise.all(
        FEATURED_CONNECTORS.map(async (c) => {
          const def = CONNECTOR_MAP[c.id];
          return [c.id, def ? await serverCanOffer(c.id, def.auth) : false] as const;
        }),
      );
      if (!cancelled) setUnavailable(new Set(results.filter(([, ok]) => !ok).map(([id]) => id)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  /**
   * An in-card prompt. api_key connectors (GitHub, Buildkite) need a token, and
   * onboarding used to bail to Customize to collect it — abandoning onboarding
   * in the process. Collecting it here keeps the user in the flow they started.
   */
  const [prompt, setPrompt] = useState<{
    connectorId: string;
    label: string;
    hint?: string;
    secret: boolean;
    resolve: (value: string | null) => void;
  } | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const askFor = useCallback(
    (connectorId: string, secret: boolean) =>
      (_c: ConnectorDefinition, field: { label: string; hint?: string }) =>
        new Promise<string | null>((resolve) => {
          setPromptValue("");
          setPrompt({ connectorId, label: field.label, hint: field.hint, secret, resolve });
        }),
    []
  );

  const settlePrompt = useCallback(
    (value: string | null) => {
      setPrompt((current) => {
        current?.resolve(value);
        return null;
      });
      setPromptValue("");
    },
    []
  );

  const handleConnect = useCallback(
    async (connectorId: string) => {
      setErrors(({ [connectorId]: _e, ...rest }) => rest);
      setNotices(({ [connectorId]: _n, ...rest }) => rest);

      const { CONNECTOR_MAP } = await import("@/lib/connectors/registry");
      const connector = CONNECTOR_MAP[connectorId];
      if (!connector) {
        setErrors((prev) => ({ ...prev, [connectorId]: `Connector ${connectorId} not found` }));
        return;
      }

      setConnectingId(connectorId);
      try {
        // One orchestrator for every auth type, so onboarding is no longer
        // limited to the plain oauth2 case.
        const outcome = await connectConnector(connector, {
          requestSecret: askFor(connectorId, true),
          requestText: askFor(connectorId, false),
          runOAuth2: (c, byoCreds) => startOAuthFlow(c, byoCreds),
          runMcpOAuth: (id, url, opts) => runMcpOAuthFlow(id, url, opts),
        });

        if (outcome.status === "cancelled") return;
        if (outcome.status !== "connected") {
          setErrors((prev) => ({
            ...prev,
            [connectorId]: outcome.message ?? "Connection failed",
          }));
          return;
        }

        setToken(connectorId, outcome.token ?? "");
        setEnabled(connectorId, true);
        // mcp-oauth entries are written server-side by the exchange route; the
        // rest are provisioned from the registry here.
        if (connector.auth.type !== "mcp-oauth") {
          await provisionConnector(connector, outcome.token ?? "", {
            refreshToken: outcome.refreshToken,
            expiresAt: outcome.expiresAt,
            oauthClientId: outcome.oauthClientId,
            oauthClientSecret: outcome.oauthClientSecret,
            oauthTokenEndpoint: outcome.oauthTokenEndpoint,
          });
        }
        if (outcome.deferredAuthHint) {
          setNotices((prev) => ({ ...prev, [connectorId]: outcome.deferredAuthHint! }));
        }
        onConnectorConnected(connectorId);
      } catch (err) {
        console.error(`Connect failed for ${connectorId}:`, err);
        clearToken(connectorId);
        setErrors((prev) => ({
          ...prev,
          [connectorId]: err instanceof Error ? err.message : "Connection failed",
        }));
      } finally {
        setConnectingId(null);
        setPrompt(null);
      }
    },
    [askFor, setToken, setEnabled, clearToken, onConnectorConnected]
  );

  return (
    <div className="flex flex-col">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 self-start"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>

      <div className="text-center mb-6">
        <h2 id="onboarding-step-title" tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
          Connect your apps
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          Optional &mdash; you can always add more later
        </p>
      </div>

      <div className="space-y-2 mb-6">
        {FEATURED_CONNECTORS.map(({ id, name, description, Logo, note }) => {
          const isConnecting = connectingId === id;
          const isAuthenticated = connectorStates[id]?.authenticated ?? false;
          const error = errors[id];

          return (
            <div
              key={id}
              className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5"
            >
              <Logo className="h-10 w-10 rounded-lg shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold leading-tight">{name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                {note && <p className="text-[11px] text-muted-foreground/80 mt-0.5">{note}</p>}
                {unavailable.has(id) && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                    Requires an app registration on this install — set it up later in Customize → Connectors.
                  </p>
                )}
                {error && (
                  <p className="text-xs text-destructive mt-1">{error}</p>
                )}
                {notices[id] && (
                  <p className="text-xs text-muted-foreground mt-1">{notices[id]}</p>
                )}
                {prompt?.connectorId === id && (
                  <form
                    className="mt-2 space-y-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      settlePrompt(promptValue.trim() || null);
                    }}
                  >
                    {prompt.hint && (
                      <p className="whitespace-pre-line text-[11px] leading-snug text-muted-foreground">
                        {prompt.hint}
                      </p>
                    )}
                    <Input
                      autoFocus
                      type={prompt.secret ? "password" : "text"}
                      value={promptValue}
                      onChange={(e) => setPromptValue(e.target.value)}
                      placeholder={prompt.label}
                      aria-label={prompt.label}
                      className="h-8 font-mono text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") settlePrompt(null);
                      }}
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="submit"
                        disabled={!promptValue.trim()}
                        className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => settlePrompt(null)}
                        className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
              <div className="shrink-0">
                {prompt?.connectorId === id ? null : isConnecting ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Connecting
                  </span>
                ) : isAuthenticated ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1.5 text-[11px] font-medium text-green-600 dark:text-green-400">
                    <Check className="h-3 w-3" />
                    Connected
                  </span>
                ) : unavailable.has(id) ? null : (
                  <button
                    type="button"
                    aria-label={`Connect ${name}`}
                    onClick={() => handleConnect(id)}
                    disabled={!!connectingId}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    <Power className="h-3 w-3" />
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="mx-auto inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
