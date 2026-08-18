'use client'

import { useState, useEffect } from 'react'
import { Target } from 'lucide-react'
import { StartGoal } from './start-goal'
import { GoalPanel } from './goal-panel'

/**
 * The entry point to a long-running goal run, under the composer.
 *
 * WHY HERE. The start form first went only into the Cowork sidebar, which does
 * not exist in the empty state — a fresh conversation renders a separate branch
 * with no sidebar at all. So the feature was invisible at precisely the moment
 * someone would want it: a folder chosen, nothing typed yet. Found by looking at
 * the screen rather than the tests.
 *
 * Collapsed by default. Ordinary chat is what this surface is for, and a form
 * that is always open would make an occasional mode look like the main one.
 */
export function GoalEntry({
  chatId,
  folder,
  surfaceId,
}: {
  chatId: string
  folder: string | null
  surfaceId: 'cowork' | 'code'
}) {
  const [open, setOpen] = useState(false)
  const [hasGoal, setHasGoal] = useState(false)

  /*
   * Does this folder already have a goal?
   *
   * Without this the empty state showed the START FORM for a run that was
   * already going — and the status panel lives in the sidebar, which the empty
   * state does not render. So a goal ran to completion, fixed the code, and the
   * only thing on screen was a form saying "this conversation already has a
   * goal". The run was working and invisible.
   */
  useEffect(() => {
    if (!folder || !chatId) return
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch(
          `/api/harness?conversationId=${encodeURIComponent(chatId)}&workingDir=${encodeURIComponent(folder)}`,
        )
        if (!res.ok || cancelled) return
        const s = (await res.json()) as { goal?: unknown }
        if (!cancelled) setHasGoal(!!s.goal)
      } catch {
        // A failed poll is not worth surfacing; the next one is 3s away.
      }
    }
    void check()
    const id = setInterval(check, 3000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [chatId, folder])

  // No folder, no run: the ledger and progress log live in the working folder,
  // and offering the option would be offering a dead end.
  if (!folder) return null

  // A goal exists — show what it is DOING, not a form to create another.
  if (hasGoal) {
    return (
      <div className="mx-auto mt-3 w-full max-w-[672px] rounded-xl border border-border/50 bg-card/50">
        <GoalPanel conversationId={chatId} workingDir={folder} surfaceId={surfaceId} />
      </div>
    )
  }

  return (
    <div className="mx-auto mt-3 w-full max-w-[672px]">
      {open ? (
        <StartGoal
          conversationId={chatId}
          workingDir={folder}
          surfaceId={surfaceId}
          onStarted={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mx-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <Target className="h-3.5 w-3.5" />
          Or pursue a goal — it works on its own until it&apos;s done
        </button>
      )}
    </div>
  )
}
