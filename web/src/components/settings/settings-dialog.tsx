"use client"

import { useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { SettingsNav } from "./settings-nav"
import { ProfileSection } from "./sections/profile-section"
import { AppearanceSection } from "./sections/appearance-section"
import { CapabilitiesSection } from "./sections/capabilities-section"
import { ConnectorsSection } from "./sections/connectors-section"
import { CoworkSection } from "./sections/cowork-section"
import { CodeSection } from "./sections/code-section"
import { DataSection } from "./sections/data-section"
import { MemorySection } from "./sections/memory-section"
import { SecuritySection } from "./sections/security-section"
import { SearchSection } from "./sections/search-section"
import { IdentitySection } from "./sections/identity-section"
import { RoiSection } from "./sections/roi-section"

const sectionComponents: Record<string, React.ComponentType> = {
  profile: ProfileSection,
  appearance: AppearanceSection,
  capabilities: CapabilitiesSection,
  identity: IdentitySection,
  connectors: ConnectorsSection,
  cowork: CoworkSection,
  code: CodeSection,
  security: SecuritySection,
  search: SearchSection,
  memory: MemorySection,
  data: DataSection,
  roi: RoiSection,
}

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState("profile")

  const ActiveComponent = sectionComponents[activeSection] ?? ProfileSection

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Backdrop */}
        <DialogPrimitive.Backdrop className="settings-backdrop fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" />

        {/* Popup — custom animation via CSS */}
        <DialogPrimitive.Popup className="settings-popup fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl max-h-[min(70vh,600px)] rounded-xl bg-background p-4 text-sm ring-1 ring-foreground/10 outline-none flex flex-col overflow-hidden">
          <DialogPrimitive.Title className="sr-only">Settings</DialogPrimitive.Title>

          {/* Close button */}
          <DialogPrimitive.Close
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          <div className="flex flex-1 gap-6 overflow-hidden">
            {/* Left sidebar navigation */}
            <div className="shrink-0 border-r border-border pr-4 pt-1">
              <SettingsNav
                activeSection={activeSection}
                onSectionChange={setActiveSection}
              />
            </div>

            {/* Right content area */}
            <div className="flex-1 overflow-y-auto px-1 pt-1">
              <ActiveComponent />
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
