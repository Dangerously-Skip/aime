"use client";

import { AlertTriangle, RefreshCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";
import { describeTurnError, type TurnErrorCode } from "@/lib/sse/turn-error";

interface TurnErrorBannerProps {
  code: TurnErrorCode;
  /** The server's message. Shown only where `describeTurnError` decides it helps. */
  message?: string;
  /** Offered when the error is retryable and this is the conversation's latest turn. */
  onRetry?: () => void;
}

/**
 * A failed turn, said plainly, with the one thing that fixes it.
 *
 * Distinct from the reply on purpose: the error used to be appended to the
 * assistant's text, so it went back to the model as something it had said and
 * showed users raw provider text — "Please run /login" for a command this app
 * does not have.
 */
export function TurnErrorBanner({ code, message, onRetry }: TurnErrorBannerProps) {
  const d = describeTurnError(code, message);
  const openSettings = useAppStore((s) => s.openSettings);
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{d.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground break-words">{d.detail}</p>
        {(d.action || (d.retryable && onRetry)) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {d.action && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={() => openSettings(d.action!.settingsSection)}
              >
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                {d.action.label}
              </Button>
            )}
            {d.retryable && onRetry && (
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Try again
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
