'use client'

import { useEffect, useState, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useHarnessRoute } from './use-start-goal'
import type { ParkedQuestion } from '@/lib/harness/question'
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
  question?: ParkedQuestion | null
  /**
   * Live tool pulse between loop events, or null when the run is not running.
   *
   * Optional on the client type because a status from an older server, or from
   * a run that predates this field, simply has no pulse — which renders as no
   * pulse rather than as a crash.
   */
  activity?: { tool: string; count: number; at: number } | null
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
}: {
  conversationId: string
  workingDir: string | null
  surfaceId: 'cowork' | 'code'
}) {
  const [status, setStatus] = useState<HarnessStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const [showOther, setShowOther] = useState(false)
  // Collapsible, like Context and Artifacts in the same rail.
  const [open, setOpen] = useState(true)
  // The resumed run needs the same credentials the first one had.
  const harnessRoute = useHarnessRoute(null)

  const send = async (text: string) => {
    if (!workingDir || !status?.question || !text.trim()) return
    setBusy(true)
    try {
      await fetch('/api/harness/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDir, conversationId, id: status.question.id, answer: text }),
      })
      /*
       * Restart the loop.
       *
       * Answering only wrote to disk — nothing re-entered runGoalLoop, so the
       * panel promised "Answer, and it carries on" and the run sat there
       * forever. The loop consumes the answer on its next pass.
       */
      await fetch('/api/harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, workingDir, surfaceId, ...harnessRoute() }),
      }).catch(() => {})
      setAnswer('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

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

  /*
   * No goal — render nothing.
   *
   * This used to render a whole start FORM, which became a second composer
   * sitting under the real one: the same sentence typed into two boxes to do one
   * thing. Starting is now the composer's own toggle; this component only
   * reports on a run that exists.
   */
  if (!status?.goal) return null

  const { goal, ledger, run, decision } = status
  const passed = ledger?.tasks.filter((t) => t.status === 'passed').length ?? 0
  const total = ledger?.tasks.length ?? 0
  const tone = toneFor(decision)
  const isComplete = total > 0 && passed === total

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <div className="space-y-1">
        {/*
          The WHOLE header toggles, chevron included.

          The comment that used to sit here claimed this matched the
          Context/Artifacts cards. It did not: the button wrapped only the
          <h3>, and the badge and chevron were siblings outside it. So the arrow
          was decorative — clicking the one control that looks like the collapse
          control did nothing, and only the word "Goal" worked.

          A disclosure arrow is where everybody clicks, so the hit area has to
          include it. `SidebarCard` gets this right, which is why the claim read
          as true to anyone checking it against the neighbour rather than
          against this markup.
        */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left"
        >
          <h3 className="flex-1 font-medium">Goal</h3>
          {status.running ? (
            <Badge variant="secondary" className="text-[10px]">running</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">idle</Badge>
          )}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          />
        </button>
        <p className="text-xs text-muted-foreground">{goal.objective}</p>
      </div>

      {!open ? null : <>
      {/*
        A parked question comes FIRST and is the only thing the user can act on.
        A run waiting on a decision is not broken and not finished; showing it
        among the stop reasons would bury the one thing that unblocks it.
      */}
      {status.question && (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5">
          <p className="text-xs font-medium">It needs a decision from you</p>
          <p className="text-xs">{status.question.question}</p>
          {status.question.context && (
            <p className="text-[11px] text-muted-foreground">{status.question.context}</p>
          )}
          {status.question.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {status.question.options.map((o) => (
                <Button key={o} size="sm" variant="outline" disabled={busy} onClick={() => send(o)}>
                  {o}
                </Button>
              ))}
              {/*
                Typing is the fallback, not the default. When the run has offered
                the alternatives, clicking one is both faster and safer — invented
                wording risks an answer the run does not recognise.
              */}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowOther((v) => !v)}>
                Other…
              </Button>
            </div>
          )}
          <div
            className={`items-center gap-1.5 ${
              status.question.options.length > 0 && !showOther ? 'hidden' : 'flex'
            }`}
          >
            <Input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(answer) }}
              placeholder="Answer, and it carries on"
              disabled={busy}
              className="h-7 text-xs"
            />
            <Button size="sm" disabled={busy || !answer.trim()} onClick={() => void send(answer)}>
              Send
            </Button>
          </div>
        </div>
      )}

      {!status.question && decision?.stop && decision.detail && (
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

      {/*
          THE PULSE.

          Loop events fire at SESSION boundaries, and a session is many minutes
          and can be a hundred tool calls. Between them the panel said nothing —
          so a run making 94 tool calls looked exactly like one that had died,
          and was reported as stopped.

          A count that MOVES is the whole signal. The tool name is a bonus that
          costs nothing and makes "is it doing something sensible" answerable too.
      */}
      {status.activity && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="truncate" data-testid="harness-activity">
            {status.activity.tool} · {status.activity.count} tool{status.activity.count === 1 ? '' : 's'} this run
          </span>
        </div>
      )}

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

      {/*
        A finished run should not occupy the surface forever.
        
        A goal is per CONVERSATION now, so the honest answer to "how do I start
        another" is a new chat — and saying so beats a button that would have to
        discard this run's ledger and progress log to make room.
      */}
      {!status.running && !status.question && (
        <p className="text-[11px] text-muted-foreground">
          {isComplete ? 'Done.' : 'Stopped.'} Toggle{' '}
          <span className="font-medium">Pursue goal</span> above to run another in this chat — this
          one keeps its plan and progress log.
        </p>
      )}
    </>}
    </div>
  )
}
