"use client";

import { useCallback } from "react";
import { useCodeStore, type ConnectionType } from "@/stores/code-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Monitor, Github, ChevronDown, LogOut } from "lucide-react";

export function ConnectionSelector() {
  const connectionType = useCodeStore((s) => s.connectionType);
  const setConnectionType = useCodeStore((s) => s.setConnectionType);
  const githubToken = useSettingsStore((s) => s.githubToken);
  const githubUser = useSettingsStore((s) => s.githubUser);
  const clearGithubAuth = useSettingsStore((s) => s.clearGithubAuth);

  const isGithubConnected = !!githubToken;

  const handleConnectGithub = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/github", { method: "POST" });
      if (!res.ok) return;
      const { url } = await res.json();

      // Try Electron popup first, fall back to window.open
      const electron = (window as { electronAPI?: { openAuthWindow?: (url: string) => Promise<void> } }).electronAPI;
      if (electron?.openAuthWindow) {
        electron.openAuthWindow(url);
      } else {
        window.open(url, "github-auth", "width=600,height=700");
      }

      // Listen for postMessage from OAuth callback
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "github-auth-success") {
          const { token, user } = event.data;
          useSettingsStore.getState().setGithubToken(token);
          useSettingsStore.getState().setGithubUser(user);
          setConnectionType("github");
          window.removeEventListener("message", handler);
        }
      };
      window.addEventListener("message", handler);
    } catch {
      // OAuth not configured — silently fail
    }
  }, [setConnectionType]);

  const handleDisconnect = useCallback(() => {
    clearGithubAuth();
    setConnectionType("local");
  }, [clearGithubAuth, setConnectionType]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            {connectionType === "github" ? (
              <Github className="h-3.5 w-3.5" />
            ) : (
              <Monitor className="h-3.5 w-3.5" />
            )}
            <span>{connectionType === "github" ? githubUser || "GitHub" : "Local"}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        }
      />

      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-52">
        <DropdownMenuRadioGroup
          value={connectionType}
          onValueChange={(v) => {
            if (v === "github" && !isGithubConnected) return;
            setConnectionType(v as ConnectionType);
          }}
        >
          <DropdownMenuRadioItem value="local">
            <Monitor className="h-4 w-4" />
            Local
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>GitHub</DropdownMenuLabel>

          {isGithubConnected ? (
            <>
              <DropdownMenuRadioGroup
                value={connectionType}
                onValueChange={(v) => setConnectionType(v as ConnectionType)}
              >
                <DropdownMenuRadioItem value="github">
                  <Github className="h-4 w-4" />
                  {githubUser || "GitHub"}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleDisconnect}>
                <LogOut className="h-4 w-4" />
                Disconnect GitHub
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={handleConnectGithub}>
              <Github className="h-4 w-4" />
              Connect to GitHub...
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
