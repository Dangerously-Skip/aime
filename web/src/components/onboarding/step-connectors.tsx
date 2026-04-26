"use client";

import { useState, useCallback } from "react";
import { useConnectorStore } from "@/stores/connector-store";
import { useAppStore } from "@/stores/app-store";
import { useSettingsStore } from "@/stores/settings-store";
import { startOAuthFlow } from "@/lib/connectors/oauth";
import { provisionConnector } from "@/lib/connectors/provisioner";
import {
  GitHubLogo,
  AtlassianLogo,
  M365GraphLogo,
  MiroLogo,
  BuildkiteLogo,
} from "@/components/customize/connector-logos";
import { ArrowLeft, Check, Loader2, Power } from "lucide-react";

// Featured connectors for onboarding — the five that actually work end-to-end.
const FEATURED_CONNECTORS = [
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
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  const setOnboardingSkippedAt = useSettingsStore((s) => s.setOnboardingSkippedAt);

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleConnect = useCallback(
    async (connectorId: string) => {
      setErrors((prev) => {
        const { [connectorId]: _, ...rest } = prev;
        return rest;
      });

      // Look up the connector — api_key / mcp-oauth / byoCredentials types
      // need dialogs that only live in the Customize view, so redirect there.
      const { CONNECTOR_MAP } = await import("@/lib/connectors/registry");
      const connector = CONNECTOR_MAP[connectorId];
      if (!connector) {
        setErrors((prev) => ({ ...prev, [connectorId]: `Connector ${connectorId} not found` }));
        return;
      }

      const isInlineOAuth2 =
        connector.auth.type === "oauth2" && !connector.auth.byoCredentials;
      if (!isInlineOAuth2) {
        // Dismiss onboarding and jump to Customize → browse-connectors so the
        // user can complete setup (paste PAT, sign in, etc) in the proper UI.
        setOnboardingSkippedAt(Date.now());
        setCustomizeSection("browse-connectors");
        return;
      }

      setConnectingId(connectorId);
      try {
        const result = await startOAuthFlow(connector);
        const expiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;
        setToken(connectorId, result.accessToken);
        setEnabled(connectorId, true);
        await provisionConnector(connector, result.accessToken, {
          refreshToken: result.refreshToken,
          expiresAt,
        });
        onConnectorConnected(connectorId);
      } catch (err) {
        console.error(`OAuth flow failed for ${connectorId}:`, err);
        if (err instanceof Error && !err.message.includes("canceled")) {
          clearToken(connectorId);
          setErrors((prev) => ({
            ...prev,
            [connectorId]: err instanceof Error ? err.message : "Connection failed",
          }));
        }
      } finally {
        setConnectingId(null);
      }
    },
    [setToken, setEnabled, clearToken, onConnectorConnected, setCustomizeSection, setOnboardingSkippedAt]
  );

  return (
    <div className="flex flex-col">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 self-start"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>

      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Connect your apps</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Optional &mdash; you can always add more later
        </p>
      </div>

      <div className="space-y-2 mb-6">
        {FEATURED_CONNECTORS.map(({ id, name, description, Logo }) => {
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
                {error && (
                  <p className="text-xs text-destructive mt-1">{error}</p>
                )}
              </div>
              <div className="shrink-0">
                {isConnecting ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Connecting
                  </span>
                ) : isAuthenticated ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1.5 text-[11px] font-medium text-green-600 dark:text-green-400">
                    <Check className="h-3 w-3" />
                    Connected
                  </span>
                ) : (
                  <button
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
        onClick={onContinue}
        className="mx-auto inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
