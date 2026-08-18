'use client'

import { useState } from 'react'
import { Target, Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * Goal mode as a property of the SEND, not a second composer.
 *
 * The first version put a whole second form under the chat box — its own
 * textarea, its own button. Which meant typing the same sentence twice into two
 * boxes to do one thing, and having to work out which box was which. A mode is
 * not a separate surface; it is a switch on the thing you were already doing.
 *
 * So: a toggle beside the folder picker, a small strip of numbers when it is on,
 * and the ordinary send button starts the run.
 */

export const DEFAULT_BUDGET_USD = 2
export const DEFAULT_SESSION_CAP = 12

export interface GoalSettings {
  budgetUsd: number
  sessionCap: number
}

export function goalSettingsFrom(budget: string, cap: string): GoalSettings | string {
  const budgetUsd = Number(budget)
  const sessionCap = Number(cap)
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) return 'Give it a budget above zero.'
  if (!Number.isInteger(sessionCap) || sessionCap <= 0) return 'Sessions must be a whole number.'
  return { budgetUsd, sessionCap }
}

/** The toggle, for the composer's button row. */
export function GoalModeToggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title="Work towards a goal across many sessions"
      className={`h-7 gap-1.5 px-2 text-xs transition-colors ${
        on ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Target className="h-3.5 w-3.5" />
      Pursue goal
    </Button>
  )
}

/** The numbers, shown only while the toggle is on. */
export function GoalModeBar({
  budget,
  cap,
  onBudget,
  onCap,
  disabled,
  error,
}: {
  budget: string
  cap: string
  onBudget: (v: string) => void
  onCap: (v: string) => void
  disabled?: boolean
  error?: string | null
}) {
  const [explain, setExplain] = useState(false)

  return (
    <div className="space-y-1.5 border-t border-border/50 bg-primary/[0.03] px-4 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Target className="h-3.5 w-3.5 text-primary" />
        <span>Runs on its own until done, checking its own work.</span>
        <button
          type="button"
          onClick={() => setExplain((v) => !v)}
          aria-label="What do these limits mean?"
          className="rounded p-0.5 hover:text-foreground"
        >
          <Info className="h-3 w-3" />
        </button>
        <span className="ml-auto flex items-center gap-1.5">
          Budget $
          <Input
            value={budget}
            onChange={(e) => onBudget(e.target.value)}
            disabled={disabled}
            inputMode="decimal"
            className="h-6 w-16 text-xs"
          />
          Sessions
          <Input
            value={cap}
            onChange={(e) => onCap(e.target.value)}
            disabled={disabled}
            inputMode="numeric"
            className="h-6 w-14 text-xs"
          />
        </span>
      </div>

      {explain && (
        <div className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            <strong className="text-foreground">How this differs from a normal message.</strong> An
            ordinary send is one turn: it answers, and stops when it runs out of things to say. A
            goal is many turns. It plans the work into checkable steps first, then does one step per
            session, and a <em>separate</em> agent that cannot edit anything re-runs your checks
            before any step counts as done. It keeps going without you until it finishes, runs out
            of budget, or hits something only you can decide — and then it waits, however long that
            takes.
          </p>
          <p>
            <strong>Budget</strong> is the most it may spend before stopping. This is the one thing
            in the app that spends money with nobody watching, so keep it a number you would not
            mind losing. <strong>Sessions</strong> caps how many separate goes it gets. It also
            stops on its own if three sessions in a row make no progress.
          </p>
        </div>
      )}

      {error && <p className="text-[11px] text-amber-600 dark:text-amber-400">{error}</p>}
    </div>
  )
}
