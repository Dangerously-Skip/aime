"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnectorStore } from "@/stores/connector-store";
import { Building2, Check, Loader2 } from "lucide-react";

interface NibSkill {
  id: string;
  name: string;
  description: string;
  installed: boolean;
}

/**
 * Lists installable skills from the private redacted-org/nib-skills repo.
 * Gated on GitHub being connected — the repo is internal, so the user's
 * token is required to read and download skills.
 */
export function NibSkillsSection() {
  const token = useConnectorStore((s) => s.tokens['github']);
  const githubConnected = useConnectorStore(
    (s) => !!s.connectorStates['github']?.authenticated && !!s.tokens['github']
  );

  const [skills, setSkills] = useState<NibSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/customize/skills/nib", {
        headers: { "x-github-token": token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to load nib skills (${res.status})`);
      setSkills(data.skills as NibSkill[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load nib skills");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (githubConnected) refresh();
  }, [githubConnected, refresh]);

  const handleInstall = useCallback(
    async (skillId: string) => {
      if (!token) return;
      setInstallingId(skillId);
      try {
        const res = await fetch("/api/customize/skills/nib/install", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-github-token": token },
          body: JSON.stringify({ skillId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Install failed (${res.status})`);
        setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, installed: true } : s)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Install failed");
      } finally {
        setInstallingId(null);
      }
    },
    [token]
  );

  if (!githubConnected) {
    return (
      <div className="w-full max-w-xl mt-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-left flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            nib Skills
          </h3>
        </div>
        <div className="rounded-lg border border-dashed border-border p-4 text-left">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Connect GitHub to install nib skills from{" "}
            <code className="text-[10px] bg-muted px-1 py-0.5 rounded">redacted-org/nib-skills</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-left flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          nib Skills
        </h3>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive mb-3">
          {error}
        </div>
      )}

      {!loading && skills.length === 0 && !error && (
        <p className="text-xs text-muted-foreground text-left">No nib skills found.</p>
      )}

      <div className="space-y-2">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 hover:border-border/80 hover:bg-accent/30 transition-colors"
          >
            <div className="flex-1 min-w-0 text-left">
              <h4 className="text-sm font-semibold leading-tight truncate">{skill.name}</h4>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {skill.description || skill.id}
              </p>
            </div>
            <div className="shrink-0">
              {skill.installed ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 px-3 py-1.5 text-[11px] font-medium">
                  <Check className="h-3 w-3" />
                  Installed
                </span>
              ) : installingId === skill.id ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Installing
                </span>
              ) : (
                <button
                  onClick={() => handleInstall(skill.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Install
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
