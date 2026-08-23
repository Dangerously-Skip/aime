'use client'

import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settings-store'
import { BellOff } from 'lucide-react'
import { inQuietHours } from '@/lib/widgets/alerting'

/**
 * When scheduled briefings may not interrupt.
 *
 * WHAT THIS DOES NOT DO, said in the UI as well as here: it does not stop
 * anything RUNNING. A briefing scheduled for 06:00 still refreshes at 06:00 and
 * still marks its tile unread — only the notification is withheld. Users reach
 * for "quiet hours" expecting either meaning, and the one that would surprise
 * them is silently skipping the work, so the panel says which it is.
 *
 * Hour granularity, not minutes. Nobody needs 22:30, the picker is half the size,
 * and every extra field is a thing to get wrong in a panel most people open once.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h)

const label = (h: number) => `${String(h).padStart(2, '0')}:00`

export function QuietHoursSection() {
  const quietHours = useSettingsStore((s) => s.quietHours)
  const setQuietHours = useSettingsStore((s) => s.setQuietHours)

  const enabled = quietHours !== null
  const from = quietHours?.fromHour ?? 22
  const to = quietHours?.toHour ?? 7

  const activeNow = inQuietHours(new Date(), quietHours)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Quiet hours</p>
              <p className="text-xs text-muted-foreground">
                Scheduled briefings still run and still mark their tile as new — they just
                won&apos;t interrupt you.
              </p>
            </div>
            <Switch
              checked={enabled}
              aria-label="Enable quiet hours"
              onCheckedChange={(on) =>
                setQuietHours(on ? { fromHour: from, toHour: to } : null)
              }
            />
          </div>

          {enabled && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">From</span>
              <select
                aria-label="Quiet hours start"
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={from}
                onChange={(e) => setQuietHours({ fromHour: Number(e.target.value), toHour: to })}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{label(h)}</option>
                ))}
              </select>
              <span className="text-muted-foreground">to</span>
              <select
                aria-label="Quiet hours end"
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={to}
                onChange={(e) => setQuietHours({ fromHour: from, toHour: Number(e.target.value) })}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{label(h)}</option>
                ))}
              </select>

              {/*
                An overnight window is the normal case and reads as an error if
                you do not say so — "from 22:00 to 07:00" looks backwards until
                it is spelled out.
              */}
              {from > to && (
                <span className="text-xs text-muted-foreground">(overnight)</span>
              )}
              {from === to && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  — always quiet
                </span>
              )}
              {activeNow && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  active now
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
