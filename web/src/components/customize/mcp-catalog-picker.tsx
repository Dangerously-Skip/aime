"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { catalogByCategory, CATALOG_EXCLUSIONS, type CatalogServer } from "@/lib/mcp/catalog";
import { runMcpOAuthFlow } from "@/lib/mcp/oauth-flow";

/**
 * One-click connect for services verified to support Dynamic Client Registration
 * (P3.6d).
 *
 * Nothing to obtain, nothing to register: click, sign in, done. Every entry was
 * confirmed by completing real OAuth discovery against the live endpoint — see
 * scripts/probe-dcr.ts — so these are not aspirational.
 */

interface McpCatalogPickerProps {
  /** Ids already provisioned, so connected services can be shown as such. */
  connectedIds?: Set<string>;
  onConnected?: (id: string) => void;
}

export function McpCatalogPicker({ connectedIds, onConnected }: McpCatalogPickerProps) {
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [justConnected, setJustConnected] = useState<Set<string>>(new Set());

  const connect = useCallback(
    async (server: CatalogServer) => {
      setConnectingId(server.id);
      setErrors(({ [server.id]: _drop, ...rest }) => rest);
      try {
        await runMcpOAuthFlow(server.id, server.url, {});
        setJustConnected((prev) => new Set(prev).add(server.id));
        onConnected?.(server.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not connect";
        if (/cancel/i.test(message)) return; // the user closed the window
        setErrors((prev) => ({
          ...prev,
          // A verified server that now refuses registration has changed its
          // behaviour; say that rather than blaming the user's input.
          [server.id]: /Dynamic Client Registration/i.test(message)
            ? "This service no longer supports automatic registration. It may need an app registered with the provider."
            : message,
        }));
      } finally {
        setConnectingId(null);
      }
    },
    [onConnected],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          These services register {`AIME`} automatically — there is nothing to set up first. Click
          one, sign in, and its tools are available.
        </p>
      </div>

      {catalogByCategory().map(({ category, label, servers }) => (
        <div key={category}>
          <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">{label}</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {servers.map((server) => {
              const connected = connectedIds?.has(server.id) || justConnected.has(server.id);
              const busy = connectingId === server.id;
              const error = errors[server.id];

              return (
                <div
                  key={server.id}
                  className="flex items-start gap-2 rounded-lg border border-border bg-card px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-xs font-medium leading-tight">
                      {server.name}
                      {server.handlesMoney && (
                        <ShieldAlert
                          className="h-3 w-3 text-amber-600 dark:text-amber-500"
                          aria-label="Handles payments"
                        />
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {server.description}
                    </p>
                    {server.handlesMoney && !connected && (
                      <p className="mt-0.5 text-[11px] leading-snug text-amber-600 dark:text-amber-500">
                        Can move money — actions will ask before running.
                      </p>
                    )}
                    {error && <p className="mt-0.5 text-[11px] text-destructive">{error}</p>}
                  </div>
                  <div className="shrink-0">
                    {connected ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3 w-3" />
                        Connected
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        disabled={!!connectingId}
                        onClick={() => void connect(server)}
                      >
                        {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Why isn&apos;t my service listed?</summary>
        <ul className="mt-1.5 space-y-1 pl-4">
          {CATALOG_EXCLUSIONS.map((e) => (
            <li key={e.name}>
              <span className="font-medium">{e.name}</span> — {e.reason}
            </li>
          ))}
          <li>
            Anything else with an MCP endpoint can still be added by URL; if it supports automatic
            registration it will connect the same way.
          </li>
        </ul>
      </details>
    </div>
  );
}
