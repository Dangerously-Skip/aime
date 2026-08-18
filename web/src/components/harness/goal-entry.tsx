'use client'

import { useState } from 'react'
import { Target } from 'lucide-react'
import { StartGoal } from './start-goal'

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

  // No folder, no run: the ledger and progress log live in the working folder,
  // and offering the option would be offering a dead end.
  if (!folder) return null

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
