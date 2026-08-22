"use client"

import { Brain, Code, Database, Fingerprint, Globe, Link, Palette, Share2, Shield, TrendingUp, User, Users, Wrench, BellOff } from 'lucide-react'
import { cn } from "@/lib/utils"

const navItems = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "capabilities", label: "Capabilities", icon: Wrench },
  { id: "identity", label: "Identity", icon: Fingerprint },
  { id: "connectors", label: "API Access", icon: Link },
  { id: "search", label: "Web Search", icon: Globe },
  { id: "sharing", label: "Sharing", icon: Share2 },
  { id: "cowork", label: "Cowork", icon: Users },
  { id: "code", label: "Code", icon: Code },
  { id: "security", label: "Security", icon: Shield },
  { id: "memory", label: "Memory", icon: Brain },
  /*
   * Its own entry for one control, deliberately. "Stop it pinging me at night"
   * is something people go looking for BY NAME, and a quiet-hours toggle buried
   * in Memory or Data is a toggle nobody finds. It is also where the per-widget
   * notification defaults will go.
   */
  { id: "notifications", label: "Notifications", icon: BellOff },
  { id: "roi", label: "Usage & ROI", icon: TrendingUp },
  { id: "data", label: "Data & Privacy", icon: Database },
] as const

interface SettingsNavProps {
  activeSection: string
  onSectionChange: (section: string) => void
}

export function SettingsNav({ activeSection, onSectionChange }: SettingsNavProps) {
  return (
    <nav className="w-36 space-y-0.5">
      {navItems.map((item) => {
        const Icon = item.icon
        const isActive = activeSection === item.id
        return (
          <button
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
