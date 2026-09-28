"use client"

import { useAppStore, type SettingsSectionId } from "@/stores/app-store"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { SettingsNav } from "./settings-nav"
import { ProfileSection } from "./sections/profile-section"
import { AppearanceSection } from "./sections/appearance-section"
import { CapabilitiesSection } from "./sections/capabilities-section"
import { ConnectorsSection } from "./sections/connectors-section"
import { DataSection } from "./sections/data-section"
import { MemorySection } from "./sections/memory-section"
import { QuietHoursSection } from "./sections/quiet-hours-section"
import { SecuritySection } from "./sections/security-section"
import { SearchSection } from "./sections/search-section"
import { SharingSection } from "./sections/sharing-section"
import { IdentitySection } from "./sections/identity-section"
import { RoiSection } from "./sections/roi-section"

/** Typed on the id union, so a section id with no component fails to compile. */
export const sectionComponents: Record<SettingsSectionId, React.ComponentType> = {
  profile: ProfileSection,
  appearance: AppearanceSection,
  capabilities: CapabilitiesSection,
  identity: IdentitySection,
  connectors: ConnectorsSection,
  security: SecuritySection,
  search: SearchSection,
  sharing: SharingSection,
  memory: MemorySection,
  notifications: QuietHoursSection,
  data: DataSection,
  roi: RoiSection,
}

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const activeSection = useAppStore((s) => s.settingsSection)
  const setActiveSection = useAppStore((s) => s.setSettingsSection)

  const ActiveComponent = sectionComponents[activeSection] ?? ProfileSection

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Backdrop */}
        <DialogPrimitive.Backdrop className="settings-backdrop fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" />

        {/* A FIXED height, not a max: with `max-h` the dialog resized to each
            section, so the nav — centred with it — moved under the cursor as
            you went down the list. The content column scrolls instead. */}
        <DialogPrimitive.Popup className="settings-popup fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-3xl h-[min(80vh,640px)] rounded-xl bg-background p-4 text-sm ring-1 ring-foreground/10 outline-none flex flex-col overflow-hidden">
          <DialogPrimitive.Title className="sr-only">Settings</DialogPrimitive.Title>

          <div className="flex min-h-0 flex-1 gap-6">
            {/* Left sidebar navigation */}
            <div className="shrink-0 overflow-y-auto border-r border-border pr-4 pt-1">
              <SettingsNav
                activeSection={activeSection}
                onSectionChange={setActiveSection}
              />
            </div>

            {/* Right column: a close row that never scrolls, so the ✕ cannot
                sit on top of section content, then the scrolling content. */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-7 shrink-0 justify-end">
                <DialogPrimitive.Close
                  render={<Button variant="ghost" size="icon-sm" aria-label="Close settings" />}
                >
                  <XIcon />
                </DialogPrimitive.Close>
              </div>
              <div data-testid="settings-content" className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 pt-1">
                <ActiveComponent />
              </div>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
