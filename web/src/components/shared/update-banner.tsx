"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface UpdateState {
  state: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  statusLabel: string | null;
}

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onUpdateState) return;
    window.electronAPI.onUpdateState((data: UpdateState) => {
      setUpdate(data);
      setDismissed(false); // re-show when state changes
    });
  }, []);

  // Only show the banner when an update is ready to install
  if (!update || update.state !== "ready" || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg max-w-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Download className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Update ready</p>
        <p className="text-xs text-muted-foreground truncate">
          {update.statusLabel ?? "Restart to install the latest version"}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => window.electronAPI?.installUpdate?.()}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Restart
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
