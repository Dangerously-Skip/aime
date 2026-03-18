"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, X, Check, AlertCircle } from "lucide-react";

type ConnectorType = "stdio" | "http" | "sse";

interface AddConnectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddConnectorDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddConnectorDialogProps) {
  const [activeTab, setActiveTab] = useState<ConnectorType>("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>([]);
  const [headerPairs, setHeaderPairs] = useState<Array<{ key: string; value: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setName("");
    setCommand("");
    setArgs("");
    setUrl("");
    setEnvPairs([]);
    setHeaderPairs([]);
    setTestResult(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = { type: activeTab };
      if (activeTab === "stdio") {
        body.command = command;
        body.args = args ? args.split(/\s+/) : [];
      } else {
        body.url = url;
        const headers: Record<string, string> = {};
        for (const p of headerPairs) {
          if (p.key.trim()) headers[p.key.trim()] = p.value;
        }
        if (Object.keys(headers).length) body.headers = headers;
      }

      const res = await fetch("/api/customize/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: unknown) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);

    const config: Record<string, unknown> = { type: activeTab };
    if (activeTab === "stdio") {
      if (!command.trim()) { setError("Command is required"); setSaving(false); return; }
      config.command = command.trim();
      if (args.trim()) config.args = args.trim().split(/\s+/);
    } else {
      if (!url.trim()) { setError("URL is required"); setSaving(false); return; }
      config.url = url.trim();
    }

    const env: Record<string, string> = {};
    for (const p of envPairs) {
      if (p.key.trim()) env[p.key.trim()] = p.value;
    }
    if (Object.keys(env).length) config.env = env;

    const headers: Record<string, string> = {};
    for (const p of headerPairs) {
      if (p.key.trim()) headers[p.key.trim()] = p.value;
    }
    if (Object.keys(headers).length) config.headers = headers;

    try {
      const res = await fetch("/api/customize/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), config }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save connector");
        return;
      }
      reset();
      onSuccess();
    } finally {
      setSaving(false);
    }
  }

  const tabs: { id: ConnectorType; label: string }[] = [
    { id: "stdio", label: "Local (stdio)" },
    { id: "http", label: "HTTP" },
    { id: "sse", label: "SSE" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Add Connector</h2>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setTestResult(null); }}
              className={`flex-1 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          {/* Name — common */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-mcp-server"
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Type-specific fields */}
          {activeTab === "stdio" && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Command</label>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y @some/mcp-server"
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Arguments</label>
                <input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="--port 3000 --verbose"
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </>
          )}

          {(activeTab === "http" || activeTab === "sse") && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground">URL</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={`https://mcp-server.example.com${activeTab === "sse" ? "/sse" : ""}`}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              {/* Headers */}
              <KeyValueEditor
                label="Headers"
                pairs={headerPairs}
                onChange={setHeaderPairs}
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer ..."
              />
            </>
          )}

          {/* Env vars — common */}
          <KeyValueEditor
            label="Environment Variables"
            pairs={envPairs}
            onChange={setEnvPairs}
            keyPlaceholder="API_KEY"
            valuePlaceholder="sk-..."
          />

          {/* Test result */}
          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                testResult.success
                  ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                  : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
              }`}
            >
              {testResult.success ? (
                <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              )}
              <span>{testResult.success ? "Connection successful" : testResult.error || "Connection failed"}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Test Connection
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyValueEditor({
  label,
  pairs,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: {
  label: string;
  pairs: Array<{ key: string; value: string }>;
  onChange: (pairs: Array<{ key: string; value: string }>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  function addPair() {
    onChange([...pairs, { key: "", value: "" }]);
  }
  function removePair(index: number) {
    onChange(pairs.filter((_, i) => i !== index));
  }
  function updatePair(index: number, field: "key" | "value", val: string) {
    const updated = [...pairs];
    updated[index] = { ...updated[index], [field]: val };
    onChange(updated);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <button onClick={addPair} className="text-xs text-primary hover:underline">
          + Add
        </button>
      </div>
      {pairs.length === 0 && (
        <p className="text-[10px] text-muted-foreground">None configured</p>
      )}
      <div className="space-y-1.5">
        {pairs.map((pair, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={pair.key}
              onChange={(e) => updatePair(i, "key", e.target.value)}
              placeholder={keyPlaceholder}
              className="flex h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <input
              value={pair.value}
              onChange={(e) => updatePair(i, "value", e.target.value)}
              placeholder={valuePlaceholder}
              className="flex h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button onClick={() => removePair(i)} className="text-muted-foreground hover:text-destructive">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
