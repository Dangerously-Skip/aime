'use client'

import { useEffect, useState, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StartGoal } from './start-goal'
import type { ModelOption } from '@/lib/models/client-options'
import type { Goal, Ledger, Task } from '@/lib/harness/ledger'
import type { RunState, StopDecision } from '@/lib/harness/stop'

/**
 * What a long-running goal run is doing, and what it has cost.
 *
 * The progress list is not decoration. The research's name for the gap that
 * opens between what a loop builds and what its owner understands is
 * comprehension debt, and the only thing standing between the user and a folder
 * of changes they did not make is a readable account of what happened. So this
 * shows the plan, the spend and the reason it stopped — not a spinner.
 *
 * Shared by Cowork and Code deliberately: the engine is one engine, and two
 * panels would drift.
 */

export interface HarnessStatus {
  running: boolean
  goal: Goal | null
  ledger: Ledger | null
  run: RunState | null
  decision: StopDecision | null
  events: { type: string; sessionIndex?: number; taskId?: string; detail?: string }[]
}

const STATUS_STYLE: Record<Task['status'], string> = {
  passed: 'text-emerald-600 dark:text-emerald-400',
  doing: 'text-amber-600 dark:text-amber-400',
  blocked: 'text-red-600 dark:text-red-400',
  todo: 'text-muted-foreground',
}

const STATUS_MARK: Record<Task['status'], string> = {
  passed: '✓',
  doing: '▸',
  blocked: '✕',
  todo: '○',
}

/** Endings a human needs to look at, versus ones that are just the end. */
function toneFor(decision: StopDecision | null): 'ok' | 'attention' {
  if (!decision?.reason) return 'ok'
  return decision.reason === 'no-progress' ||
    decision.reason === 'stuck-task' ||
    decision.reason === 'error'
    ? 'attention'
    : 'ok'
}

export function GoalPanel({
  conversationId,
  workingDir,
  surfaceId,
  modelRoute = null,
}: {
  conversationId: string
  workingDir: string | null
  surfaceId: 'cowork' | 'code'
  /** The surface's pinned model, if any. Null means follow Settings. */
  modelRoute?: ModelOption | null
}) {
  const [status, setStatus] = useState<HarnessStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!workingDir) return
    try {
      const res = await fetch(
        `/api/harness?conversationId=${encodeURIComponent(conversationId)}&workingDir=${encodeURIComponent(workingDir)}`,
      )
      if (res.ok) setStatus((await res.json()) as HarnessStatus)
    } catch {
      // A failed poll is not worth surfacing; the next one is 2s away.
    }
  }, [conversationId, workingDir])

  useEffect(() => {
    void refresh()
    /*
     * Polling rather than a stream. The run outlives any one request by design,
     * so there is no stream to attach to — and a poll that misses is
     * self-healing where a dropped SSE connection would silently freeze the
     * panel on stale state.
     */
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [refresh])

  const stop = async () => {
    setBusy(true)
    try {
      await fetch('/api/harness', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!workingDir) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        Pick a folder to run a goal in. {surfaceId === 'code' ? 'Code' : 'Cowork'} keeps the run’s
        plan and progress there.
      </p>
    )
  }

  if (!status?.goal) {
    // No goal — offer to start one. Until this existed the panel could report a
    // run and nothing could create one, so the feature was unreachable.
    return (
      <div className="p-3">
        <StartGoal
          conversationId={conversationId}
          workingDir={workingDir}
          surfaceId={surfaceId}
          modelRoute={modelRoute}
          onStarted={refresh}
        />
      </div>
    )
  }

  const { goal, ledger, run, decision } = status
  const passed = ledger?.tasks.filter((t) => t.status === 'passed').length ?? 0
  const total = ledger?.tasks.length ?? 0
  const tone = toneFor(decision)

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Goal</h3>
          {status.running ? (
            <Badge variant="secondary" className="text-[10px]">running</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">idle</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{goal.objective}</p>
      </div>

      {decision?.stop && decision.detail && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            tone === 'attention'
              ? 'border-amber-500/40 bg-amber-500/5'
              : 'border-border bg-muted/30'
          }`}
        >
          <span className="font-medium">Stopped</span> — {decision.detail}
          {tone === 'attention' && (
            <span className="mt-1 block text-muted-foreground">
              This one needs you. It will not restart on its own.
            </span>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Plan — {passed} of {total} passed
          </span>
          {run && (
            <span className="tabular-nums">
              {run.sessions} session{run.sessions === 1 ? '' : 's'} · ${run.spentUsd.toFixed(2)}
              {goal.budgetUsd !== null && ` of $${goal.budgetUsd.toFixed(2)}`}
            </span>
          )}
        </div>
        <ul className="space-y-1">
          {ledger?.tasks.map((t) => (
            <li key={t.id} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 ${STATUS_STYLE[t.status]}`}>{STATUS_MARK[t.status]}</span>
              <span className="min-w-0 flex-1">
                <span className={t.status === 'passed' ? 'text-muted-foreground' : ''}>
                  {t.title}
                </span>
                {/*
                  Phase 1 has no verifier, so a pass is the session's own claim.
                  Saying so is the difference between "it works" and "the agent
                  said so" — a distinction this app has got wrong before.
                */}
                {t.status === 'passed' && !t.lastVerdict && (
                  <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                    unverified
                  </span>
                )}
                {t.status === 'passed' && t.lastVerdict?.passed && (
                  <span className="ml-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                    verified
                  </span>
                )}
                {t.attempts > 1 && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    {t.attempts} attempts
                  </span>
                )}
                {/*
                  Why a task is not done, in the verifier's own words. Without
                  this a task grinding through attempts looks like bad luck
                  rather than a specific, repeated, readable failure.
                */}
                {t.status !== 'passed' && t.lastVerdict && !t.lastVerdict.passed && (
                  <span className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400">
                    {t.lastVerdict.missing[0]}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {status.events.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">Recent</h4>
          <ul className="space-y-0.5">
            {status.events.slice(-6).reverse().map((e, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">
                {e.type === 'tamper' ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    rejected plan edit — {e.detail}
                  </span>
                ) : (
                  <>
                    {e.sessionIndex ? `session ${e.sessionIndex}` : e.type}
                    {e.taskId ? ` · ${e.taskId}` : ''}
                    {e.detail ? ` · ${e.detail}` : ''}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.running && (
        <Button size="sm" variant="outline" onClick={stop} disabled={busy}>
          {busy ? 'Stopping…' : 'Stop after this session'}
        </Button>
      )}
    </div>
  )
}
