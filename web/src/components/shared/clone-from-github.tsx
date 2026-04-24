"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Github, Search, Loader2, Lock, Check } from "lucide-react";

interface Repo {
  fullName: string;
  name: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  description: string | null;
}

interface CloneFromGitHubProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: (path: string) => void;
}

export function CloneFromGitHub({ open, onOpenChange, onCloned }: CloneFromGitHubProps) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cloningRepo, setCloningRepo] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    // Token lives server-side in ~/.claude/.quarry-mcp.json — the route
    // looks it up directly so we don't need to pass one from the client.
    fetch("/api/github/repos")
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error))))
      .then((data) => setRepos(data as Repo[]))
      .catch((err) => setError(typeof err === "string" ? err : "Failed to load repos"))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
    );
  }, [repos, search]);

  const handleClone = useCallback(
    async (repo: Repo) => {
      setCloningRepo(repo.fullName);
      setError(null);
      try {
        const [owner, name] = repo.fullName.split("/");
        const res = await fetch("/api/github/clone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner,
            repo: name,
            defaultBranch: repo.defaultBranch,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Clone failed: ${res.status}`);
        onCloned(data.path);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Clone failed");
      } finally {
        setCloningRepo(null);
      }
    },
    [onCloned, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            Clone from GitHub
          </DialogTitle>
          <DialogDescription>
            Pick a repository to clone to <code className="text-xs">~/Quarry/repos/</code> and open it for coding.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            placeholder="Search repos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 pl-8 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 -mx-2 px-2">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && !loading && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-12">
              {search ? "No repos match your search." : "No repos found."}
            </p>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="space-y-1.5 py-2">
              {filtered.map((repo) => {
                const isCloning = cloningRepo === repo.fullName;
                return (
                  <button
                    key={repo.fullName}
                    onClick={() => handleClone(repo)}
                    disabled={!!cloningRepo}
                    className="w-full text-left rounded-md border border-border bg-card hover:bg-accent/40 disabled:opacity-50 disabled:cursor-not-allowed p-3 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate flex-1">
                        {repo.fullName}
                      </span>
                      {repo.private && (
                        <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                      {isCloning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          Clone →
                        </span>
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {repo.description}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
