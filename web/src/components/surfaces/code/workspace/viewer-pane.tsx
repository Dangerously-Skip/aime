"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Loader2,
  AlertTriangle,
  GitCompare,
  Copy,
  ExternalLink,
  Pencil,
  Save,
  Undo2,
  X as XIcon,
  Search,
  Check,
} from "lucide-react";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import { readFile, writeFile } from "@/lib/code-workspace/ipc";
import { getRenderer, UNPRINTABLE_BINARY_EXTS } from "@/components/shared/file-renderers";
import { Button } from "@/components/ui/button";
import { getExt, MAX_AUTO_LOAD_BYTES } from "@/lib/code-workspace/fs-tree";

interface ViewerPaneProps {
  workspace: string | null;
  /** Direct path override — when set, ignore the store's activeTab and
   *  render this file (used by per-file dockview tabs). */
  forcedPath?: string;
}

interface FileLoadState {
  loading: boolean;
  error: string | null;
  content: string;
  encoding: "utf-8" | "base64";
  binary: boolean;
  size: number;
  needsConfirm: boolean;
}

const EMPTY_LOAD: FileLoadState = {
  loading: false,
  error: null,
  content: "",
  encoding: "utf-8",
  binary: false,
  size: 0,
  needsConfirm: false,
};

/**
 * Renders the active tab. Files go through the shared file-renderers/
 * pipeline by extension; diff tabs are stubbed (Phase 2 / Agent B owns
 * diff rendering).
 */
export function ViewerPane({ workspace, forcedPath }: ViewerPaneProps) {
  const { activeTab } = useCodeWorkspace(workspace);
  const [load, setLoad] = useState<FileLoadState>(EMPTY_LOAD);
  const [overrideLarge, setOverrideLarge] = useState(false);

  // Edit-mode state. Lives in the pane so each per-file dockview tab keeps
  // its own draft + dirty flag.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [copyAck, setCopyAck] = useState(false);

  const openExternal = (p: string) => {
    if (typeof window !== "undefined" && window.electronAPI?.openPath) {
      void window.electronAPI.openPath(p);
    }
  };

  // `forcedPath` (from a per-file dockview tab) wins. Falls back to the
  // store's activeTab when used in the legacy single-pane mode.
  const path = forcedPath ?? (activeTab?.kind === "file" ? activeTab.path : null);
  const ext = useMemo(() => (path ? getExt(path) : ""), [path]);
  const name = useMemo(() => {
    if (!path) return "";
    const segs = path.split(/[\\/]/);
    return segs[segs.length - 1] || path;
  }, [path]);

  // Reset override + state when the active file changes.
  useEffect(() => {
    setOverrideLarge(false);
    setLoad(EMPTY_LOAD);
    setEditing(false);
    setDraft("");
    setSaveError(null);
    setJustSaved(false);
  }, [path]);

  // Load file content.
  useEffect(() => {
    if (!path) return;
    if (UNPRINTABLE_BINARY_EXTS.has(ext)) {
      // Fallback renderer will handle it without needing content.
      setLoad({ ...EMPTY_LOAD, binary: true });
      return;
    }
    let cancelled = false;
    setLoad({ ...EMPTY_LOAD, loading: true });
    (async () => {
      const result = await readFile(path);
      if (cancelled) return;
      if (!result) {
        setLoad({ ...EMPTY_LOAD, error: "Failed to read file." });
        return;
      }
      const size = (result as { size?: number }).size ?? result.content.length;
      const binary =
        (result as { binary?: boolean }).binary === true ||
        result.encoding === "binary";
      // Defer load when the file is large.
      if (!overrideLarge && size > MAX_AUTO_LOAD_BYTES) {
        setLoad({
          ...EMPTY_LOAD,
          size,
          needsConfirm: true,
        });
        return;
      }
      setLoad({
        loading: false,
        error: null,
        content: result.content,
        encoding: binary ? "base64" : "utf-8",
        binary,
        size,
        needsConfirm: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [path, ext, overrideLarge]);

  // Empty / diff / loading / error / large-file states — these render
  // without the toolbar.

  if (!activeTab && !forcedPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-6">
        <FileText className="h-8 w-8 opacity-40" strokeWidth={1.5} />
        <p className="text-sm">No file open</p>
        <p className="text-xs">Click a file in the tree to start.</p>
      </div>
    );
  }

  if (activeTab?.kind === "diff" && !forcedPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-6">
        <GitCompare className="h-8 w-8 opacity-40" strokeWidth={1.5} />
        <p className="text-sm">Diff viewer — Phase 2</p>
        <p className="text-xs">{activeTab.path}</p>
      </div>
    );
  }

  if (load.loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-xs">Loading {name}…</p>
      </div>
    );
  }

  if (load.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-destructive gap-2 p-6">
        <AlertTriangle className="h-6 w-6" strokeWidth={1.5} />
        <p className="text-sm">{load.error}</p>
      </div>
    );
  }

  if (load.needsConfirm) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 p-6">
        <AlertTriangle className="h-6 w-6 text-amber-500" strokeWidth={1.5} />
        <p className="text-sm">Large file</p>
        <p className="text-xs text-muted-foreground">
          {name} is {(load.size / 1024 / 1024).toFixed(1)}&nbsp;MB. Loading
          may be slow.
        </p>
        <Button variant="outline" size="sm" onClick={() => setOverrideLarge(true)}>
          Load anyway
        </Button>
      </div>
    );
  }

  const dirty = editing && draft !== load.content;
  const canEdit = !load.binary && load.encoding === "utf-8";

  async function copyPath() {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopyAck(true);
      setTimeout(() => setCopyAck(false), 1200);
    } catch { /* ignore */ }
  }

  function startEdit() {
    setDraft(load.content);
    setEditing(true);
    setSaveError(null);
    setJustSaved(false);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft("");
    setSaveError(null);
  }
  async function save() {
    if (!path) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await writeFile(path, draft);
      if (res.ok) {
        setLoad((l) => ({ ...l, content: draft, size: draft.length }));
        setEditing(false);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
      } else {
        setSaveError(res.error ?? "Save failed.");
      }
    } finally {
      setSaving(false);
    }
  }

  const Renderer = path ? getRenderer(ext) : null;

  return (
    <FileEditor
      path={path}
      name={name}
      dirty={dirty}
      editing={editing}
      canEdit={canEdit}
      saving={saving}
      saveError={saveError}
      justSaved={justSaved}
      copyAck={copyAck}
      onCopyPath={copyPath}
      onOpenExternal={() => path && openExternal(path)}
      onEdit={startEdit}
      onCancelEdit={cancelEdit}
      onSave={save}
    >
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="h-full w-full resize-none bg-transparent font-mono text-[12.5px] leading-[1.55] text-foreground/90 outline-none px-3.5 py-3"
          autoFocus
        />
      ) : Renderer ? (
        <div className="file-viewer-body h-full overflow-auto px-3.5 py-3">
          <Renderer
            content={load.content}
            encoding={load.encoding}
            ext={ext}
            name={name}
            path={path ?? ""}
            onOpenExternal={openExternal}
          />
        </div>
      ) : null}
    </FileEditor>
  );
}

interface FileEditorProps {
  path: string | null;
  name: string;
  dirty: boolean;
  editing: boolean;
  canEdit: boolean;
  saving: boolean;
  saveError: string | null;
  justSaved: boolean;
  copyAck: boolean;
  onCopyPath: () => void;
  onOpenExternal: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  children: React.ReactNode;
}

/** Toolbar + body chrome for the file viewer / editor. The toolbar lives
 *  inside the panel body so it stays attached to the file's content even
 *  when dockview groups the panel together with other tabs. */
function FileEditor({
  path,
  name,
  dirty,
  editing,
  canEdit,
  saving,
  saveError,
  justSaved,
  copyAck,
  onCopyPath,
  onOpenExternal,
  onEdit,
  onCancelEdit,
  onSave,
  children,
}: FileEditorProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");

  useEffect(() => {
    if (findOpen) searchRef.current?.focus();
  }, [findOpen]);

  // Cmd/Ctrl+S — save. Cmd/Ctrl+F — find. Esc — close find.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && editing) {
        e.preventDefault();
        onSave();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      } else if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, findOpen, onSave]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-2 h-8 shrink-0 min-w-0">
        <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {path ?? name}
        </span>
        {dirty && (
          <span
            className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-500 mr-1"
            title="Unsaved changes"
            aria-label="Unsaved changes"
          />
        )}
        <ToolbarBtn
          onClick={onCopyPath}
          title={copyAck ? "Copied!" : "Copy path"}
          icon={copyAck ? Check : Copy}
        />
        <ToolbarBtn
          onClick={() => setFindOpen((v) => !v)}
          title="Find in file (⌘F)"
          icon={Search}
          active={findOpen}
        />
        <ToolbarBtn
          onClick={onOpenExternal}
          title="Reveal in Finder / open"
          icon={ExternalLink}
        />
        {!editing && canEdit && (
          <ToolbarBtn onClick={onEdit} title="Edit (hand-edit this file)" icon={Pencil} />
        )}
        {editing && (
          <>
            <ToolbarBtn
              onClick={onSave}
              title={dirty ? "Save (⌘S)" : justSaved ? "Saved" : "Save"}
              icon={justSaved ? Check : Save}
              disabled={!dirty || saving}
              accent={dirty}
            />
            <ToolbarBtn onClick={onCancelEdit} title="Discard edits" icon={Undo2} />
          </>
        )}
      </div>
      {findOpen && (
        <div className="flex items-center gap-2 px-2 h-7 shrink-0 border-t border-border/30">
          <Search className="h-3 w-3 text-muted-foreground" strokeWidth={1.75} />
          <input
            ref={searchRef}
            type="text"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            onClick={() => setFindOpen(false)}
            className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
            aria-label="Close find"
          >
            <XIcon className="h-3 w-3" strokeWidth={1.75} />
          </button>
        </div>
      )}
      {saveError && (
        <div className="px-3 py-1 text-[11px] text-destructive bg-destructive/5 border-t border-destructive/20 shrink-0">
          {saveError}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

interface ToolbarBtnProps {
  onClick: () => void;
  title: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
}

function ToolbarBtn({ onClick, title, icon: Icon, active, accent, disabled }: ToolbarBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={[
        "h-6 w-6 inline-flex items-center justify-center rounded transition-colors shrink-0",
        disabled
          ? "text-muted-foreground/40 cursor-not-allowed"
          : accent
            ? "text-primary hover:bg-primary/10"
            : active
              ? "text-foreground bg-muted/60"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}
