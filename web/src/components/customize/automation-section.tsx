'use client';

import React, { useRef, useState } from 'react';
import { APP_NAME } from '@/config/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Clock,
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
import { SchedulePicker, type ScheduleChange } from '@/components/schedule/schedule-picker';
import { describeTrigger, type Trigger } from '@/lib/schedule/schedule';
import { approvalPolicyLabel } from '@/lib/runs/format';
import { ATTENDED_JOB_POLICY } from '@/lib/runs/standing-order-goal';

// ── Scheduled jobs ────────────────────────────────────────────────────────────

interface CronDraft {
  trigger: Trigger;
  prompt: string;
}

/** Monday 9am — the same starting point a project's schedule form offers. */
const DEFAULT_JOB_TRIGGER: Trigger = { type: 'cron', expression: '0 9 * * 1' };

function CronPanel({ initialDraft }: { initialDraft?: CronDraft | null }) {
  /*
   * BOTH STORES (DR-24 step 5). This listed and wrote the browser cron store, so
   * moving only the writes would have created jobs the panel could not show.
   * `useAttendedJobs` does both over the same dual read the ticker uses, which
   * is what makes the list a user edits the list that actually fires.
   */
  const { jobs, create, setEnabled, remove } = useAttendedJobs();

  const startTrigger = initialDraft?.trigger ?? DEFAULT_JOB_TRIGGER;
  /*
   * THE shared SchedulePicker, not a raw 5-field box. The box accepted only
   * cron (so "every 2 hours" was unreachable here while a project could say
   * it), checked nothing but the field count, and showed no preview — the
   * picker validates with the tickers' own parsers and says when it next runs.
   */
  const [schedule, setSchedule] = useState<ScheduleChange>({ trigger: startTrigger, error: null });
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? '');
  const [surfaceId, setSurfaceId] = useState('cowork');
  const [adding, setAdding] = useState(!!initialDraft);
  const [error, setError] = useState('');

  const handleAdd = async () => {
    setError('');
    if (!prompt.trim()) {
      setError('Prompt is required');
      return;
    }
    const trigger = schedule.trigger;
    if (!trigger) {
      setError(schedule.error ?? 'Pick a schedule');
      return;
    }

    /*
     * A round trip now, where the store call could not fail. Reporting the
     * failure is the whole difference: silently losing the job the user just
     * described is the worst outcome available here.
     */
    const id = await create({ trigger, prompt: prompt.trim(), surfaceId });
    if (!id) {
      setError('Could not save the job. Check that the app is running and try again.');
      return;
    }
    setSchedule({ trigger: DEFAULT_JOB_TRIGGER, error: null });
    setPrompt('');
    setAdding(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Scheduled jobs
        </h3>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {adding && (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="space-y-1">
            <span className="text-xs font-medium">When</span>
            <SchedulePicker value={startTrigger} onChange={setSchedule} compact />
            <p className="text-[11px] text-muted-foreground">
              Runs in the surface you pick, in a conversation of its own — only while {APP_NAME} is open.{' '}
              {approvalPolicyLabel(ATTENDED_JOB_POLICY)}
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="cron-prompt" className="text-xs font-medium">Prompt</label>
            <Input
              id="cron-prompt"
              placeholder="Summarize my notifications"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="cron-surface" className="text-xs font-medium">Surface</label>
            <select
              id="cron-surface"
              value={surfaceId}
              onChange={(e) => setSurfaceId(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs"
            >
              <option value="cowork">Cowork</option>
              <option value="chat">Chat</option>
              <option value="code">Code</option>
            </select>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(''); }}>Cancel</Button>
          </div>
        </div>
      )}

      {jobs.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">No scheduled jobs yet. Add one to run a prompt on a timetable.</p>
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
              {/* In words, with the raw expression on hover — the unified
                  trigger carries intervals too, which a cron job never could. */}
              <p className="text-xs text-muted-foreground" title={job.trigger.expression}>
                {describeTrigger(job.trigger)}
              </p>
              <p className="text-xs mt-0.5 truncate">{job.prompt}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge variant="secondary" className="text-[10px] h-4 px-1">{job.surfaceId}</Badge>
                <span className="text-[10px] text-muted-foreground">Needs {APP_NAME} open</span>
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
              aria-label="Delete this job"
              title="Delete this job"
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

// ── Heartbeat ────────────────────────────────────────────────────────────────

/**
 * What the morning check-in would have done, expressed as the thing that runs.
 */
export const MORNING_BRIEFING_DRAFT: CronDraft = {
  trigger: { type: 'cron', expression: '0 9 * * 1-5' },
  prompt:
    "Give me a morning briefing: what's on today, open items, and key updates from my connected apps.",
};

function ModeCard({ icon, label, description }: { icon: React.ReactNode; label: string; description: string }) {
  return (
    <div className="border border-border rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <div>
            <p className="text-xs font-medium">{label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <Switch
          checked={false}
          disabled
          aria-label={`${label} — not available yet`}
          className="shrink-0"
        />
      </div>
    </div>
  );
}

/**
 * Heartbeat check-ins, shown honestly as not yet available.
 *
 * The switches saved `heartbeatModes` to settings and NOTHING read it: no
 * scheduler, no route, no hook — `runSilentHeartbeat` was disabled long ago.
 * So switching on a morning briefing did nothing, and the dimmed, unexplained
 * off state was the only hint. A control that claims to schedule something
 * and schedules nothing is the shape the security toggles shipped in, so the
 * switches are disabled with the reason beside them, and the one thing that
 * does run on a timer — a cron job — is offered in their place.
 */
function HeartbeatSettings({ onScheduleBriefing }: { onScheduleBriefing: () => void }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          Heartbeat
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Not available yet</Badge>
        </h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          Proactive check-ins aren&apos;t scheduled by this version of {APP_NAME}, so these stay off
          until they do. To get a daily briefing now, schedule it as a job.
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={onScheduleBriefing}>
          <Sunrise className="h-3.5 w-3.5 mr-1.5" />
          Schedule a morning briefing
        </Button>
      </div>
      <ModeCard
        icon={<Sunrise className="h-4 w-4" />}
        label="Morning Briefing"
        description="Daily briefing at a set time — what's on today, open items, key updates."
      />
      <ModeCard
        icon={<Sunset className="h-4 w-4" />}
        label="Evening Wrap-up"
        description="End-of-day summary — what got done, what's outstanding, tomorrow's priorities."
      />
      <ModeCard
        icon={<Timer className="h-4 w-4" />}
        label="Idle Nudge"
        description="A gentle check-in after a period of inactivity."
      />
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AutomationSection() {
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  // Keyed so a new draft remounts the cron panel with its form open and filled.
  const [cronDraft, setCronDraft] = useState<{ n: number; draft: CronDraft } | null>(null);
  const cronRef = useRef<HTMLDivElement>(null);

  const scheduleBriefing = () => {
    setCronDraft((prev) => ({ n: (prev?.n ?? 0) + 1, draft: MORNING_BRIEFING_DRAFT }));
    requestAnimationFrame(() => cronRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Back to Customize"
          onClick={() => setCustomizeSection('landing')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-sm font-semibold">Automation</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-8">
        <HeartbeatSettings onScheduleBriefing={scheduleBriefing} />
        <div className="border-t border-border" />
        <div ref={cronRef}>
          <CronPanel key={cronDraft?.n ?? 0} initialDraft={cronDraft?.draft} />
        </div>
        <div className="border-t border-border" />
        <DoctorPanel />
      </div>
    </div>
  );
}
