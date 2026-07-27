"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, ServerCog } from "lucide-react";
import {
  validateMcpServerUrl,
  deriveServerName,
  hostSlugName,
  isNameTakenError,
} from "@/lib/mcp/url-guard";
import { runMcpOAuthFlow } from "@/lib/mcp/oauth-flow";

/**
 * Add a remote MCP server by URL (P3.6b) — the front door for the DCR path.
 *
 * This is what generalises "one click, nobody registers an OAuth app" past the
 * sixteen hardcoded connectors: paste a vendor's MCP endpoint, and discovery
 * (RFC 9728/8414) plus Dynamic Client Registration (7591) do the rest. No
 * client_id to obtain, no OAuth app to create, no third party holding tokens.
 *
 * The URL is validated here for immediate feedback and again server-side, which
 * is where it actually matters — this component is not the security boundary.
 */

interface AddMcpServerProps {
  /** Called after a server is connected, so the caller can refresh its lists. */
  onAdded?: (name: string) => void;
}

type Phase = "idle" | "connecting" | "added";

export function AddMcpServer({ onAdded }: AddMcpServerProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [addedName, setAddedName] = useState<string | null>(null);

  const trimmed = url.trim();
  // Live validation, but stay quiet until there is something worth judging.
  const verdict = useMemo(
    () => (trimmed.length > 0 ? validateMcpServerUrl(trimmed) : null),
    [trimmed],
  );
  const derivedName = useMemo(
    () => (verdict?.ok ? deriveServerName(verdict.url) : null),
    [verdict],
  );
  const canSubmit = !!verdict?.ok && !!derivedName && phase !== "connecting";

  const submit = useCallback(async () => {
    if (!verdict?.ok || !derivedName) return;
    setPhase("connecting");
    setError(null);
    try {
      // Discovery + DCR + browser consent + provisioning, all already built.
      let name = derivedName;
      try {
        await runMcpOAuthFlow(name, verdict.url, {});
      } catch (err) {
        // The friendly short name is already registered to a DIFFERENT origin —
        // two vendors can share a label (mcp.acme.com and acme.io both derive
        // `acme`). The server refuses rather than reusing that registration,
        // because reusing it would show the consent screen of a server the user
        // never typed. Retry under a name unique to this origin; the refusal
        // happens during discovery, before any browser window opens, so this is
        // invisible unless it also fails.
        const message = err instanceof Error ? err.message : String(err);
        const fallback = hostSlugName(verdict.url);
        if (!isNameTakenError(message) || !fallback || fallback === name) throw err;
        name = fallback;
        await runMcpOAuthFlow(name, verdict.url, {});
      }
      setAddedName(name);
      setPhase("added");
      setUrl("");
      onAdded?.(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not connect to that server";
      // A server without DCR and without a published client_id genuinely cannot
      // be added this way; say so plainly rather than surfacing protocol noise.
      setError(
        /Dynamic Client Registration/i.test(message)
          ? "That server does not support automatic registration, so it needs an OAuth app registered with the provider first."
          : message,
      );
      setPhase("idle");
    }
  }, [verdict, derivedName, onAdded]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        Add MCP server
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <ServerCog className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">Add an MCP server</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Paste the server&apos;s URL. If it supports automatic registration you&apos;ll just be
            asked to sign in — nothing to set up first.
          </p>

          <form
            className="mt-2.5 space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              autoFocus
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="https://mcp.example.com/mcp"
              aria-label="MCP server URL"
              className="h-8 font-mono text-xs"
            />

            {verdict && !verdict.ok && (
              <p className="text-xs text-destructive">{verdict.message}</p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            {verdict?.ok && derivedName && !error && (
              <p className="text-xs text-muted-foreground">
                Will be added as <code className="font-mono">{derivedName}</code>
                {verdict.loopback ? " (local server)" : ""}
              </p>
            )}
            {verdict?.ok && !derivedName && !error && (
              // Reachable only when the host would name a service AIME already
              // ships and nothing else can be derived from it. Saying so beats a
              // disabled button with no explanation.
              <p className="text-xs text-destructive">
                That host cannot be named without clashing with a built-in connector.
              </p>
            )}

            <div className="flex gap-1.5 pt-0.5">
              <Button type="submit" size="sm" className="h-7 text-xs" disabled={!canSubmit}>
                {phase === "connecting" && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                Connect
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setOpen(false);
                  setUrl("");
                  setError(null);
                  setPhase("idle");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>

          {phase === "added" && addedName && (
            <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              Connected {addedName}. Its tools are available in your next message.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
