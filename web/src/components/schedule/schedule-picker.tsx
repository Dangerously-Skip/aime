"use client";

import { useId, useMemo, useState } from "react";
import {
  SCHEDULE_KIND_LABELS,
  WEEKDAY_NAMES,
  describeTrigger,
  formatNextRun,
  nextRunForTrigger,
  specToTrigger,
  triggerToSpec,
  validateSpec,
  type RunTiming,
  type ScheduleKind,
  type ScheduleSpec,
  type Trigger,
} from "@/lib/schedule/schedule";

/**
 * THE schedule input. Every place in the app that asks "when should this run?"
 * renders this, so a schedule is typed, validated and previewed one way.
 *
 * WHY. Scheduling was a raw 5-field cron box with a field-count check (and in the
 * order editor, no check at all). `0 9 * * MON-FRI` was accepted and never ran;
 * nothing said when a job would next fire, so the only way to find out a
 * schedule was wrong was to wait for it not to happen. Presets cover what people
 * actually schedule; "Custom (cron)" keeps the full power one click away; and the
 * summary + "Next run" line under it is computed by the same parsers the
 * tickers run, so the preview cannot promise a run that never comes.
 */

export interface ScheduleChange {
  /** Null while the input is invalid. */
  trigger: Trigger | null;
  error: string | null;
}

interface SchedulePickerProps {
  /** The stored trigger to start from. Event triggers are not edited here. */
  value?: Trigger;
  onChange: (change: ScheduleChange) => void;
  /** For the next-run preview: when it last ran / was created, and its status. */
  timing?: RunTiming;
  /** Test seam for the preview clock. */
  now?: number;
  /** Visually compact variant for inline forms. */
  compact?: boolean;
}

const inputClass =
  "text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary";

function defaultFor(kind: ScheduleKind, from: ScheduleSpec): ScheduleSpec {
  const time = "time" in from ? from.time : "09:00";
  switch (kind) {
    case "every-minutes": return { kind, every: 30 };
    case "every-hours": return { kind, every: 1 };
    case "daily": return { kind, time };
    case "weekdays": return { kind, time };
    case "weekly": return { kind, day: 1, time };
    case "custom": return { kind, expression: from.kind === "custom" ? from.expression : specToTrigger(from).expression ?? "" };
  }
}

export function SchedulePicker({ value, onChange, timing, now, compact }: SchedulePickerProps) {
  const id = useId();
  const [spec, setSpec] = useState<ScheduleSpec>(() => triggerToSpec(value));
  // The preview's clock: when the picker opened. Good enough for "next run",
  // and render stays pure.
  const [openedAt] = useState(() => Date.now());

  const error = validateSpec(spec);
  const trigger = error ? null : specToTrigger(spec);

  const preview = useMemo(() => {
    if (!trigger) return null;
    const at = now ?? openedAt;
    // A new schedule's first interval counts from now, like the ticker's.
    const next = nextRunForTrigger(trigger, { status: "active", createdAt: at, ...timing }, at);
    return { summary: describeTrigger(trigger), next: next === null ? null : formatNextRun(next, at) };
  }, [trigger, timing, now, openedAt]);

  const update = (next: ScheduleSpec) => {
    setSpec(next);
    const err = validateSpec(next);
    onChange({ trigger: err ? null : specToTrigger(next), error: err });
  };

  const number = (label: string, max: number) => (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Every</span>
      <input
        id={`${id}-every`}
        type="number"
        min={1}
        max={max}
        step={1}
        aria-label={`Every how many ${label}`}
        value={"every" in spec && Number.isFinite(spec.every) ? spec.every : ""}
        onChange={(e) => update({ ...(spec as Extract<ScheduleSpec, { every: number }>), every: e.target.valueAsNumber })}
        className={`${inputClass} w-24`}
      />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );

  const time = (
    <input
      id={`${id}-time`}
      type="time"
      aria-label="Time"
      value={"time" in spec ? spec.time : ""}
      onChange={(e) => update({ ...(spec as Extract<ScheduleSpec, { time: string }>), time: e.target.value })}
      className={`${inputClass} w-32`}
    />
  );

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-kind`} className="sr-only">Repeat</label>
        <select
          id={`${id}-kind`}
          value={spec.kind}
          onChange={(e) => update(defaultFor(e.target.value as ScheduleKind, spec))}
          className={inputClass}
        >
          {(Object.keys(SCHEDULE_KIND_LABELS) as ScheduleKind[]).map((k) => (
            <option key={k} value={k}>{SCHEDULE_KIND_LABELS[k]}</option>
          ))}
        </select>

        {spec.kind === "every-minutes" && number("minutes", 1440)}
        {spec.kind === "every-hours" && number("hours", 168)}
        {(spec.kind === "daily" || spec.kind === "weekdays") && time}
        {spec.kind === "weekly" && (
          <>
            <select
              aria-label="Day of the week"
              value={spec.day}
              onChange={(e) => update({ ...spec, day: Number(e.target.value) })}
              className={inputClass}
            >
              {WEEKDAY_NAMES.map((d, i) => (
                <option key={d} value={i}>{d}</option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">at</span>
            {time}
          </>
        )}
      </div>

      {spec.kind === "custom" && (
        <div>
          <input
            type="text"
            aria-label="Custom schedule"
            value={spec.expression}
            onChange={(e) => update({ kind: "custom", expression: e.target.value })}
            placeholder="*/15 9-17 * * MON-FRI  or  90m"
            className={`${inputClass} w-full font-mono`}
            spellCheck={false}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Cron: minute hour day-of-month month day-of-week — or an interval like 90m, 2h, 1d.
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : preview ? (
        <p className="text-xs text-muted-foreground" data-testid="schedule-preview">
          <span className="text-foreground">{preview.summary}</span>
          {" · "}
          {preview.next ? `Next run: ${preview.next}` : "Will not run again"}
        </p>
      ) : null}
    </div>
  );
}
