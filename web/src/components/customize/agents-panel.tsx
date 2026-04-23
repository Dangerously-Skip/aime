"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/stores/app-store";
import { useCoworkStore } from "@/stores/cowork-store";
import {
  Bot,
  Plus,
  Trash2,
  ArrowLeft,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { AgentConfig } from "@/lib/agents-parser";

type Scope = "global" | "workspace";

interface AgentWithScope extends AgentConfig {
  scope: Scope;
}

const MODEL_OPTIONS = [
  { value: "", label: "Default" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku" },
  { value: "claude-sonnet-4-6", label: "Sonnet" },
  { value: "claude-opus-4-6", label: "Opus" },
];

function modelLabel(model?: string): string {
  if (!model) return "Default";
  const opt = MODEL_OPTIONS.find((o) => o.value === model);
  return opt ? opt.label : model;
}

function emptyDraft(scope: Scope): AgentWithScope {
  return {
    name: "",
    description: "",
    model: "",
    systemPrompt: "",
    allowedTools: [],
    triggers: [],
    scope,
  };
}

export function AgentsPanel() {
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  const selectedAgentName = useAppStore((s) => s.selectedAgentName);
  const setSelectedAgentName = useAppStore((s) => s.setSelectedAgentName);
  const cwd = useCoworkStore((s) =>
    s.currentChatId ? s.folderByChat[s.currentChatId] ?? null : null
  );

  const [agents, setAgents] = useState<AgentWithScope[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editor state
  const [draft, setDraft] = useState<AgentWithScope | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fetchAgents = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    fetch(`/api/agents${qs}`)
      .then((r) => r.json())
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => setError("Failed to load agents"))
      .finally(() => setLoading(false));
  }, [cwd]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Sync selectedAgentName → draft
  useEffect(() => {
    if (!selectedAgentName) return;
    const found = agents.find((a) => a.name === selectedAgentName);
    if (found) {
      setDraft({ ...found });
      setIsNew(false);
      setConfirmDelete(false);
    }
  }, [selectedAgentName, agents]);

  function handleNewAgent() {
    const defaultScope: Scope = cwd ? "workspace" : "global";
    setDraft(emptyDraft(defaultScope));
    setIsNew(true);
    setConfirmDelete(false);
    setSelectedAgentName(null);
  }

  function handleBack() {
    setDraft(null);
    setIsNew(false);
    setSelectedAgentName(null);
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Agent name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const agent: AgentConfig = {
        name: draft.name.trim(),
        description: draft.description,
        model: draft.model || undefined,
        systemPrompt: draft.systemPrompt || undefined,
        allowedTools: draft.allowedTools?.length ? draft.allowedTools : undefined,
        triggers: draft.triggers?.length ? draft.triggers : undefined,
      };
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, scope: draft.scope, cwd }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Save failed");
      }
      await fetchAgents();
      setSelectedAgentName(draft.name.trim());
      setIsNew(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, scope: draft.scope, cwd }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Delete failed");
      }
      await fetchAgents();
      handleBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const showEditor = draft !== null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={() => {
            if (showEditor) {
              handleBack();
            } else {
              setCustomizeSection("landing");
            }
          }}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold flex-1">
          {showEditor
            ? isNew
              ? "New Agent"
              : draft?.name || "Edit Agent"
            : "Agents"}
        </span>
        {!showEditor && (
          <Button size="sm" variant="outline" onClick={handleNewAgent}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New
          </Button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Content */}
      {!showEditor ? (
        /* Agent list */
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-8">
              <Bot className="h-8 w-8 text-muted-foreground" strokeWidth={1.25} />
              <p className="text-sm text-muted-foreground">
                No agents defined. Create one to get started.
              </p>
              <Button size="sm" variant="outline" onClick={handleNewAgent}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                New agent
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {agents.map((agent) => (
                <button
                  key={`${agent.scope}:${agent.name}`}
                  onClick={() => {
                    setDraft({ ...agent });
                    setIsNew(false);
                    setConfirmDelete(false);
                    setSelectedAgentName(agent.name);
                  }}
                  className="group flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg border border-border bg-muted/30 shrink-0">
                    <Bot className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{agent.name}</span>
                      {agent.model && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {modelLabel(agent.model)}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 h-4 capitalize"
                      >
                        {agent.scope}
                      </Badge>
                    </div>
                    {agent.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {agent.description}
                      </p>
                    )}
                    <div className="flex gap-2 mt-1">
                      {agent.allowedTools && agent.allowedTools.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {agent.allowedTools.length} tool{agent.allowedTools.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      {agent.triggers && agent.triggers.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {agent.triggers.length} trigger{agent.triggers.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Editor */
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Name *</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. researcher"
              disabled={!isNew}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
            {!isNew && (
              <p className="text-[10px] text-muted-foreground">
                Name cannot be changed after creation.
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What does this agent do?"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            <select
              value={draft.model ?? ""}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* System Prompt */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">System Prompt</label>
            <Textarea
              value={draft.systemPrompt ?? ""}
              onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
              placeholder="Instructions for the agent…"
              className="min-h-[120px] text-sm resize-y"
            />
          </div>

          {/* Allowed Tools */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Allowed Tools{" "}
              <span className="font-normal text-muted-foreground/70">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={(draft.allowedTools ?? []).join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  allowedTools: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              placeholder="WebSearch, WebFetch, Read, Bash"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Triggers */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Triggers{" "}
              <span className="font-normal text-muted-foreground/70">(comma-separated keywords)</span>
            </label>
            <input
              type="text"
              value={(draft.triggers ?? []).join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  triggers: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              placeholder="research, investigate, find out"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Scope */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Scope</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraft({ ...draft, scope: "global" })}
                className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                  draft.scope === "global"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground hover:bg-muted/30"
                }`}
              >
                Global
              </button>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, scope: "workspace" })}
                disabled={!cwd}
                className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                  draft.scope === "workspace"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground hover:bg-muted/30"
                }`}
              >
                Workspace
              </button>
            </div>
            {draft.scope === "workspace" && cwd && (
              <p className="text-[10px] text-muted-foreground truncate">
                Writes to: {cwd}/AGENTS.md
              </p>
            )}
            {!cwd && (
              <p className="text-[10px] text-muted-foreground">
                Open a folder in Cowork to enable workspace scope.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="flex-1"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={handleBack} disabled={saving}>
              Cancel
            </Button>
            {!isNew && (
              <Button
                size="sm"
                variant={confirmDelete ? "destructive" : "outline"}
                onClick={handleDelete}
                disabled={deleting || saving}
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {confirmDelete && !deleting && <span className="ml-1">Confirm</span>}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
