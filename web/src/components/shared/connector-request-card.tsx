"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Plug, X, Loader2 } from "lucide-react";
import { CONNECTOR_MAP } from "@/lib/connectors/registry";
import { connectConnector } from "@/lib/connectors/connect";
import { provisionConnector } from "@/lib/connectors/provisioner";
import { startOAuthFlow } from "@/lib/connectors/oauth";
import { runMcpOAuthFlow } from "@/lib/mcp/oauth-flow";
import { useConnectorStore } from "@/stores/connector-store";
import type { ConnectorDefinition } from "@/lib/connectors/types";

/**
 * Inline "connect this to continue" card (P3.3).
 *
 * The agent hit a task it needs a service for and paused. Connecting here — in
 * the conversation, at the moment it matters — is faster than any settings
 * screen, because the user never leaves what they were doing and the agent picks
 * the task straight back up.
 *
 * Reuses the shared orchestrator, so this card implements no auth logic of its
 * own; it only supplies the prompts and reports the outcome back to the paused
 * turn.
 */

interface ConnectorRequestCardProps {
  toolUseId: string;
  connectorId: string;
  reason?: string;
  /** Set when this card was already answered (replayed from history). */
  settled?: boolean;
}

type Phase = "idle" | "connecting" | "connected" | "declined" | "failed";

async function report(toolUseId: string, connected: boolean, reason?: string): Promise<void> {
  await fetch("/api/chat/connector-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolUseId, connected, reason }),
  }).catch(() => {
    // The turn will time out on its own if this never lands; nothing useful to
    // show the user here beyond the card's own state.
  });
}

export function ConnectorRequestCard({
  toolUseId,
  connectorId,
  reason,
  settled = false,
}: ConnectorRequestCardProps) {
  const connector: ConnectorDefinition | undefined = CONNECTOR_MAP[connectorId];
  const [phase, setPhase] = useState<Phase>(settled ? "connected" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{
    label: string;
    hint?: string;
    secret: boolean;
    resolve: (v: string | null) => void;
  } | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const setToken = useConnectorStore((s) => s.setToken);
  const setEnabled = useConnectorStore((s) => s.setEnabled);
  const clearToken = useConnectorStore((s) => s.clearToken);

  const ask = useCallback(
    (secret: boolean) => (_c: ConnectorDefinition, field: { label: string; hint?: string }) =>
      new Promise<string | null>((resolve) => {
        setPromptValue("");
        setPrompt({ label: field.label, hint: field.hint, secret, resolve });
      }),
    [],
  );

  const settlePrompt = useCallback((value: string | null) => {
    setPrompt((current) => {
      current?.resolve(value);
      return null;
    });
    setPromptValue("");
  }, []);

  const handleConnect = useCallback(async () => {
    if (!connector) return;
    setPhase("connecting");
    setError(null);
    try {
      const outcome = await connectConnector(connector, {
        requestSecret: ask(true),
        requestText: ask(false),
        runOAuth2: (c, byoCreds) => startOAuthFlow(c, byoCreds),
        runMcpOAuth: (id, url, opts) => runMcpOAuthFlow(id, url, opts),
      });

      if (outcome.status !== "connected") {
        const message =
          outcome.status === "cancelled" ? "The user cancelled." : outcome.message ?? "Connection failed";
        setPhase(outcome.status === "cancelled" ? "declined" : "failed");
        if (outcome.status !== "cancelled") setError(message);
        await report(toolUseId, false, message);
        return;
      }

      setToken(connectorId, outcome.token ?? "");
      setEnabled(connectorId, true);
      // mcp-oauth entries are written server-side by the exchange route.
      if (connector.auth.type !== "mcp-oauth") {
        await provisionConnector(connector, outcome.token ?? "", {
          refreshToken: outcome.refreshToken,
          expiresAt: outcome.expiresAt,
          oauthClientId: outcome.oauthClientId,
          oauthClientSecret: outcome.oauthClientSecret,
          oauthTokenEndpoint: outcome.oauthTokenEndpoint,
        });
      }
      setPhase("connected");
      await report(toolUseId, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      clearToken(connectorId);
      setPhase("failed");
      setError(message);
      await report(toolUseId, false, message);
    } finally {
      setPrompt(null);
    }
  }, [connector, connectorId, ask, setToken, setEnabled, clearToken, toolUseId]);

  const handleDecline = useCallback(async () => {
    setPhase("declined");
    setPrompt(null);
    await report(toolUseId, false, "The user declined to connect it.");
  }, [toolUseId]);

  // An unknown id means the agent invented one. Tell the paused turn so it
  // doesn't sit there for five minutes.
  if (!connector) {
    if (phase === "idle") {
      setPhase("failed");
      void report(toolUseId, false, `There is no connector with id "${connectorId}".`);
    }
    return (
      <div className="rounded-xl border border-border bg-card p-3.5 text-xs text-muted-foreground">
        Requested an unknown service (<code>{connectorId}</code>).
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <Plug className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">Connect {connector.name}?</p>
          {reason && <p className="mt-0.5 text-xs text-muted-foreground">{reason}</p>}

          {prompt && (
            <form
              className="mt-2.5 space-y-1.5"
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
                <Button type="submit" size="sm" className="h-7 text-xs" disabled={!promptValue.trim()}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => settlePrompt(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}

          {!prompt && phase !== "connected" && phase !== "declined" && (
            <div className="mt-2.5 flex gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => void handleConnect()}
                disabled={phase === "connecting"}
              >
                {phase === "connecting" && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                {phase === "failed" ? "Try again" : "Connect"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => void handleDecline()}
                disabled={phase === "connecting"}
              >
                Not now
              </Button>
            </div>
          )}

          {phase === "connected" && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              Connected — continuing
            </p>
          )}
          {phase === "declined" && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <X className="h-3 w-3" />
              Skipped
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
