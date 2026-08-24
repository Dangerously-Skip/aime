'use client';

import React, { useState } from 'react';
import { useSettingsStore, type HeartbeatModes } from '@/stores/settings-store';
import { useConnectorStore } from '@/stores/connector-store';
import { CONNECTOR_REGISTRY } from '@/lib/connectors/registry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Clock,
  Webhook,
  Plus,
  Trash2,
  ChevronLeft,
  Sunrise,
  Sunset,
  Timer,
} from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { DoctorPanel } from './doctor-panel';
import { useAttendedJobs } from '@/hooks/use-attended-jobs';

// ── Cron panel ────────────────────────────────────────────────────────────────

function CronPanel() {
  /*
   * BOTH STORES (DR-24 step 5). This listed and wrote the browser cron store, so
   * moving only the writes would have created jobs the panel could not show.
   * `useAttendedJobs` does both over the same dual read the ticker uses, which
   * is what makes the list a user edits the list that actually fires.
   */
  const { jobs, create, setEnabled, remove } = useAttendedJobs();

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

    /*
     * A round trip now, where the store call could not fail. Reporting the
     * failure is the whole difference: silently losing the job the user just
     * described is the worst outcome available here.
     */
    const id = await create({ expression: expr.trim(), prompt: prompt.trim(), surfaceId });
    if (!id) {
      setError('Could not save the job. Check that the app is running and try again.');
      return;
    }
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
              checked={job.status === 'active'}
              aria-label={`${job.status === 'active' ? 'Pause' : 'Resume'} this job`}
              onCheckedChange={() => void setEnabled(job.id, job.status !== 'active')}
              className="mt-0.5 shrink-0"
            />
            <div className="flex-1 min-w-0">
              {/* `trigger.expression` — the unified shape carries interval and
                  event triggers too, which a cron job never could. */}
              <p className="text-xs font-mono text-muted-foreground">{job.trigger.expression}</p>
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
              onClick={() => void remove(job.id)}
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
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Webhook className="h-4 w-4" />
        Webhooks
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Coming soon</Badge>
      </h3>
      <p className="text-[11px] text-muted-foreground">
        Trigger agent runs from external services. Requires a public URL or tunnel — coming in a future update.
      </p>
    </div>
  );
}

// ── Heartbeat settings ────────────────────────────────────────────────────────

function ConnectorCheckboxes({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const isAuthenticated = useConnectorStore((s) => s.isAuthenticated);
  const connected = CONNECTOR_REGISTRY.filter((c) => !c.comingSoon && isAuthenticated(c.id));

  if (connected.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No connected apps yet — connect them in the Connectors section.
      </p>
    );
  }

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {connected.map((c) => {
        const active = selected.includes(c.id);
        return (
          <button
            key={c.id}
            onClick={() => toggle(c.id)}
            className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/40'
            }`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

interface ModeCardProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  modeKey: keyof HeartbeatModes;
}

function ModeCard({ icon, label, description, modeKey }: ModeCardProps) {
  const mode = useSettingsStore((s) => s.heartbeatModes[modeKey]);
  const setHeartbeatMode = useSettingsStore((s) => s.setHeartbeatMode);
  const isIdle = modeKey === 'idle';

  return (
    <div className={`border rounded-lg p-3 space-y-3 transition-colors ${mode.enabled ? 'border-border' : 'border-border/50 opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <div>
            <p className="text-xs font-medium">{label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <Switch
          checked={mode.enabled}
          onCheckedChange={(v) => setHeartbeatMode(modeKey, { enabled: v })}
          className="shrink-0"
        />
      </div>

      {mode.enabled && (
        <div className="space-y-2.5 pt-0.5">
          {isIdle ? (
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground shrink-0">After</label>
              <Input
                type="number"
                min={5}
                value={mode.idleMinutes}
                onChange={(e) => setHeartbeatMode(modeKey, { idleMinutes: Math.max(5, Number(e.target.value)) })}
                className="h-7 text-xs w-20"
              />
              <label className="text-[11px] text-muted-foreground">minutes of inactivity</label>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground shrink-0">Time</label>
              <Input
                type="time"
                value={mode.time}
                onChange={(e) => setHeartbeatMode(modeKey, { time: e.target.value })}
                className="h-7 text-xs w-28"
              />
            </div>
          )}

          {!isIdle && (
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">Pull from</label>
              <ConnectorCheckboxes
                selected={mode.connectors}
                onChange={(ids) => setHeartbeatMode(modeKey, { connectors: ids })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HeartbeatSettings() {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Heartbeat</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Proactive check-ins that surface insights from your connected apps.
        </p>
      </div>
      <ModeCard
        icon={<Sunrise className="h-4 w-4" />}
        label="Morning Briefing"
        description="Daily briefing at a set time — what's on today, open items, key updates."
        modeKey="morning"
      />
      <ModeCard
        icon={<Sunset className="h-4 w-4" />}
        label="Evening Wrap-up"
        description="End-of-day summary — what got done, what's outstanding, tomorrow's priorities."
        modeKey="evening"
      />
      <ModeCard
        icon={<Timer className="h-4 w-4" />}
        label="Idle Nudge"
        description="A gentle check-in after a period of inactivity."
        modeKey="idle"
      />
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
