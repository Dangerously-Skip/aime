"use client"

import { Brain, Database, Fingerprint, Globe, KeyRound, Palette, Share2, Shield, TrendingUp, User, Wrench, BellOff } from 'lucide-react'
import { cn } from "@/lib/utils"
import type { SettingsSectionId } from "@/stores/app-store"

interface NavItem {
  id: SettingsSectionId
  label: string
  icon: typeof User
}

/**
 * Grouped, and ordered by what a new install needs first: nothing works until a
 * model is reachable, so that leads. "API Access" was renamed for what it holds
 * — every provider, the tier grid and the image model, not just an API key.
 *
 * The section id stays `connectors`: `openSettings('connectors')` is how an
 * error card sends someone here to fix their key.
 */
export const NAV_GROUPS: ReadonlyArray<{ label: string; items: ReadonlyArray<NavItem> }> = [
  {
    label: "Models",
    items: [{ id: "connectors", label: "Models & API keys", icon: KeyRound }],
  },
  {
    label: "You",
    items: [
      { id: "profile", label: "Profile", icon: User },
      { id: "identity", label: "Identity", icon: Fingerprint },
      { id: "memory", label: "Memory", icon: Brain },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "capabilities", label: "Capabilities", icon: Wrench },
      { id: "search", label: "Web search", icon: Globe },
      { id: "sharing", label: "Sharing", icon: Share2 },
      /*
       * Its own entry for one control, deliberately. "Stop it pinging me at
       * night" is something people go looking for BY NAME, and a quiet-hours
       * toggle buried in Memory or Data is a toggle nobody finds. It is also
       * where the per-widget notification defaults will go.
       */
      { id: "notifications", label: "Notifications", icon: BellOff },
    ],
  },
  {
    label: "Safety & data",
    items: [
      { id: "security", label: "Security", icon: Shield },
      { id: "roi", label: "Usage & ROI", icon: TrendingUp },
      { id: "data", label: "Data & privacy", icon: Database },
    ],
  },
]

interface SettingsNavProps {
  activeSection: SettingsSectionId
  onSectionChange: (section: SettingsSectionId) => void
}

export function SettingsNav({ activeSection, onSectionChange }: SettingsNavProps) {
  return (
    <nav aria-label="Settings sections" className="w-40 space-y-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="space-y-0.5">
          <p className="px-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSectionChange(item.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
