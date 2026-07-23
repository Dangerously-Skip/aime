"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMarketplace } from "@/lib/use-marketplace";
import { PluginRow } from "./plugin-row";
import { Zap, FileText, Trash2, Pencil, Loader2, Plus, Check, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SkillFrontmatter } from "@/lib/skill-parser";

interface SkillData {
  id: string;
  name: string;
  description: string;
  path: string;
  frontmatter: SkillFrontmatter;
  content: string;
  files: string[];
}

interface SkillDetailProps {
  skillId: string | null;
}

const SKILL_CATEGORIES = ['productivity', 'testing', 'design', 'learning'];

export function SkillDetail({ skillId }: SkillDetailProps) {
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  const [skill, setSkill] = useState<SkillData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Create skill form
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newContent, setNewContent] = useState("");

  // Marketplace plugins for empty state
  const { plugins: marketplacePlugins } = useMarketplace();
  const skillPlugins = marketplacePlugins
    .filter((p) => SKILL_CATEGORIES.includes(p.category || ''))
    .slice(0, 5);

  const fetchSkill = useCallback((id: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/customize/skills/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Skill not found");
        return r.json();
      })
      .then((data) => setSkill(data.skill))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (skillId) {
      fetchSkill(skillId);
      setCreating(false);
    } else {
      setSkill(null);
    }
  }, [skillId, fetchSkill]);

  async function handleDelete() {
    if (!skill) return;
    if (!confirm(`Delete skill "${skill.name}"? This removes the entire skill directory.`)) return;
    await fetch(`/api/customize/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" });
    setSkill(null);
  }

  async function handleSaveEdit() {
    if (!skill) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/customize/skills/${encodeURIComponent(skill.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        const data = await res.json();
        setSkill(data.skill);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/customize/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
          content: newContent.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSkill(data.skill);
        setCreating(false);
        setNewName("");
        setNewDescription("");
        setNewContent("");
      }
    } finally {
      setSaving(false);
    }
  }

  // Empty state
  if (!skillId && !creating) {
    return (
      <div className="flex flex-1 flex-col items-center p-8 text-center overflow-y-auto min-h-0 pt-16">
        <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 text-primary mb-4">
          <Zap className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">Skills</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Skills are reusable prompts and workflows stored in{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">~/.claude/skills/</code>.
          Select a skill from the sidebar or create a new one.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create skill
        </Button>

        {/* Marketplace skill plugins */}
        {skillPlugins.length > 0 && (
          <div className="w-full max-w-xl mt-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-left">From the Marketplace</h3>
              <button
                onClick={() => setCustomizeSection("browse-marketplace")}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View all
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-2">
              {skillPlugins.map((plugin) => (
                <PluginRow key={plugin.name} plugin={plugin} compact />
              ))}
            </div>
          </div>
        )}

      </div>
    );
  }

  // Create form
  if (creating) {
    return (
      <div className="flex flex-1 flex-col p-6 max-w-2xl mx-auto w-full">
        <h2 className="text-lg font-semibold mb-4">Create New Skill</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my-skill"
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What does this skill do?"
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Instructions (SKILL.md body)
            </label>
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Write the skill instructions in markdown..."
              rows={12}
              className="mt-1 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleCreate} disabled={saving || !newName.trim()} size="sm">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
              Create
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              <X className="h-3.5 w-3.5 mr-1.5" />
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error
  if (error || !skill) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {error || "Skill not found"}
      </div>
    );
  }

  const fm = skill.frontmatter;

  return (
    <div className="flex flex-1 flex-col p-6 max-w-2xl mx-auto w-full overflow-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">{skill.name}</h2>
          </div>
          {skill.description && (
            <p className="text-sm text-muted-foreground">{skill.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setEditing(true);
              setEditContent(skill.content);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground mb-6">
        <div>
          <span className="font-medium text-foreground">Added by:</span> User
        </div>
        <div>
          <span className="font-medium text-foreground">Invoked by:</span>{" "}
          {fm["user-invocable"] !== false ? "User or Claude" : "Claude only"}
        </div>
        {fm.model && (
          <div>
            <span className="font-medium text-foreground">Model:</span> {fm.model}
          </div>
        )}
        {fm["allowed-tools"] && (
          <div>
            <span className="font-medium text-foreground">Tools:</span>{" "}
            {(fm["allowed-tools"] as string[]).join(", ")}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">SKILL.md</h3>
          <button
            onClick={() => setShowCode(!showCode)}
            className="text-[10px] font-medium text-primary hover:underline"
          >
            {showCode ? "Preview" : "View source"}
          </button>
        </div>

        {editing ? (
          <div className="space-y-3">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={20}
              className="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : showCode ? (
          <pre className="rounded-lg border border-border bg-muted/50 p-4 text-xs font-mono overflow-auto whitespace-pre-wrap">
            {skill.content || "(empty)"}
          </pre>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 text-sm leading-relaxed prose prose-sm max-w-none">
            {skill.content || (
              <span className="text-muted-foreground italic">No content</span>
            )}
          </div>
        )}
      </div>

      {/* Files */}
      {skill.files.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-medium">Files</h3>
          <div className="rounded-lg border border-border divide-y divide-border">
            {skill.files.map((file) => (
              <div
                key={file}
                className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="font-mono">{file}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
