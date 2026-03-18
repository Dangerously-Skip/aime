'use client';

import { useState } from 'react';
import { useCronStore } from '@/stores/cron-store';
import { useSettingsStore } from '@/stores/settings-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Clock,
  Webhook,
  Plus,
  Trash2,
  Copy,
  Check,
  ChevronLeft,
} from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { DoctorPanel } from './doctor-panel';

// ── Webhook types / store (in-memory via API) ─────────────────────────────────

interface WebhookConfig {
  id: string;
  token: string;
  name: string;
  targetSurface: string;
  systemPrompt: string;
  enabled: boolean;
  createdAt: number;
}

function useWebhooks() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/webhooks');
      const data = await res.json() as { webhooks: WebhookConfig[] };
      setWebhooks(data.webhooks ?? []);
    } finally {
      setLoading(false);
    }
  };

  const create = async (name: string, targetSurface: string) => {
    const res = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, targetSurface }),
    });
    await reload();
    return res.ok;
  };

  const remove = async (id: string) => {
    await fetch('/api/webhooks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await reload();
  };

  return { webhooks, loading, reload, create, remove };
}

// ── Cron panel ────────────────────────────────────────────────────────────────

function CronPanel() {
  const jobs = useCronStore((s) => s.jobs);
  const addJob = useCronStore((s) => s.addJob);
  const removeJob = useCronStore((s) => s.removeJob);
  const toggleJob = useCronStore((s) => s.toggleJob);

  const [expr, setExpr] = useState('');
  const [prompt, setPrompt] = useState('');
  const [surfaceId, setSurfaceId] = useState('cowork');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async () => {
    setError('');
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
      setError('Expression must have 5 fields: min hour dom month dow');
      return;
    }
    if (!prompt.trim()) {
      setError('Prompt is required');
      return;
    }

    // Server-side validation
    const res = await fetch('/api/cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression: expr.trim(), prompt: prompt.trim(), surfaceId }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setError(d.error ?? 'Invalid');
      return;
    }

    addJob({ expression: expr.trim(), prompt: prompt.trim(), surfaceId, enabled: true });
    setExpr('');
    setPrompt('');
    setAdding(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Cron Jobs
        </h3>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {adding && (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="space-y-1">
            <label className="text-xs font-medium">Cron Expression</label>
            <Input
              placeholder="0 9 * * 1"
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              className="h-8 text-xs font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              min hour dom month dow — e.g. <code>0 9 * * 1</code> = every Monday at 9am
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Prompt</label>
            <Input
              placeholder="Summarize my GitHub notifications"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Surface</label>
            <select
              value={surfaceId}
              onChange={(e) => setSurfaceId(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs"
            >
              <option value="cowork">Cowork</option>
              <option value="chat">Chat</option>
              <option value="code">Code</option>
            </select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(''); }}>Cancel</Button>
          </div>
        </div>
      )}

      {jobs.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">No cron jobs yet. Add one to schedule recurring agent runs.</p>
      )}

      <div className="space-y-2">
        {jobs.map((job) => (
          <div key={job.id} className="flex items-start gap-3 p-3 border border-border rounded-lg">
            <Switch
              checked={job.enabled}
              onCheckedChange={() => toggleJob(job.id)}
              className="mt-0.5 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-muted-foreground">{job.expression}</p>
              <p className="text-xs mt-0.5 truncate">{job.prompt}</p>
              <div className="flex gap-1.5 mt-1">
                <Badge variant="secondary" className="text-[10px] h-4 px-1">{job.surfaceId}</Badge>
                {job.lastRun && (
                  <span className="text-[10px] text-muted-foreground">
                    last: {new Date(job.lastRun).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeJob(job.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Webhook panel ─────────────────────────────────────────────────────────────

function WebhookPanel() {
  const { webhooks, reload, create, remove } = useWebhooks();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [surface, setSurface] = useState('cowork');
  const [adding, setAdding] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const ensureLoaded = () => {
    if (!loaded) { reload(); setLoaded(true); }
  };

  const handleAdd = async () => {
    if (!name.trim()) return;
    await create(name.trim(), surface);
    setName('');
    setAdding(false);
  };

  const copyUrl = (token: string, id: string) => {
    const url = `${window.location.origin}/api/webhooks/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-4" onClick={ensureLoaded}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Webhook className="h-4 w-4" />
          Webhooks
        </h3>
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); ensureLoaded(); setAdding((v) => !v); }}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {adding && (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="space-y-1">
            <label className="text-xs font-medium">Name</label>
            <Input
              placeholder="GitHub PR webhook"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Target Surface</label>
            <select
              value={surface}
              onChange={(e) => setSurface(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs"
            >
              <option value="cowork">Cowork</option>
              <option value="chat">Chat</option>
              <option value="code">Code</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd}>Create</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {loaded && webhooks.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">No webhooks yet. Create one to trigger agent runs from external services.</p>
      )}
      {!loaded && (
        <p className="text-xs text-muted-foreground">Click anywhere to load webhooks.</p>
      )}

      <div className="space-y-2">
        {webhooks.map((wh) => (
          <div key={wh.id} className="flex items-start gap-3 p-3 border border-border rounded-lg">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold">{wh.name}</p>
              <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
                /api/webhooks/{wh.token.slice(0, 12)}…
              </p>
              <Badge variant="secondary" className="text-[10px] h-4 px-1 mt-1">{wh.targetSurface}</Badge>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground"
                title="Copy webhook URL"
                onClick={() => copyUrl(wh.token, wh.id)}
              >
                {copiedId === wh.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => remove(wh.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Heartbeat settings ────────────────────────────────────────────────────────

function HeartbeatSettings() {
  const heartbeatEnabled = useSettingsStore((s) => s.heartbeatEnabled);
  const heartbeatIntervalMinutes = useSettingsStore((s) => s.heartbeatIntervalMinutes);
  const setHeartbeatEnabled = useSettingsStore((s) => s.setHeartbeatEnabled);
  const setHeartbeatIntervalMinutes = useSettingsStore((s) => s.setHeartbeatIntervalMinutes);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Heartbeat</h3>
      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs font-medium">Enable periodic check-ins</label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Agent proactively surfaces insights on an interval
          </p>
        </div>
        <Switch
          checked={heartbeatEnabled}
          onCheckedChange={setHeartbeatEnabled}
        />
      </div>
      {heartbeatEnabled && (
        <div className="space-y-1">
          <label className="text-xs font-medium">Interval (minutes)</label>
          <Input
            type="number"
            min={1}
            value={heartbeatIntervalMinutes}
            onChange={(e) => setHeartbeatIntervalMinutes(Math.max(1, Number(e.target.value)))}
            className="h-8 text-xs w-24"
          />
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AutomationSection() {
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCustomizeSection('landing')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-sm font-semibold">Automation</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-8">
        <HeartbeatSettings />
        <div className="border-t border-border" />
        <CronPanel />
        <div className="border-t border-border" />
        <WebhookPanel />
        <div className="border-t border-border" />
        <DoctorPanel />
      </div>
    </div>
  );
}
