'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

export function ProfileSection() {
  const setOnboardingComplete = useSettingsStore((s) => s.setOnboardingComplete)
  const setOnboardingSkippedAt = useSettingsStore((s) => s.setOnboardingSkippedAt)

  /**
   * The way back into setup, and the reason skipping can be permanent.
   *
   * Clearing both flags is all this needs: `app/page.tsx` renders the wizard
   * INSTEAD of the app shell, and this dialog lives inside that shell — so the
   * settings window goes away with it rather than needing to be closed first.
   */
  const rerunSetup = () => {
    setOnboardingComplete(false)
    setOnboardingSkippedAt(null)
  }

  const fullName = useSettingsStore((s) => s.fullName)
  const setFullName = useSettingsStore((s) => s.setFullName)
  const displayName = useSettingsStore((s) => s.displayName)
  const setDisplayName = useSettingsStore((s) => s.setDisplayName)
  const workFunction = useSettingsStore((s) => s.workFunction)
  const setWorkFunction = useSettingsStore((s) => s.setWorkFunction)
  const personalPreferences = useSettingsStore((s) => s.personalPreferences)
  const setPersonalPreferences = useSettingsStore((s) => s.setPersonalPreferences)

  return (
    <div className="space-y-6">
      <div>
        <label className="text-sm font-medium">Full name</label>
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1.5"
        />
      </div>

      <div>
        <label className="text-sm font-medium">Display name</label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-1.5"
        />
        <p className="text-xs text-muted-foreground mt-1">
          What should Claude call you?
        </p>
      </div>

      <div>
        <label className="text-sm font-medium">Work function</label>
        <Input
          value={workFunction}
          onChange={(e) => setWorkFunction(e.target.value)}
          placeholder="e.g. Software Engineer"
          className="mt-1.5"
        />
      </div>

      <div>
        <label className="text-sm font-medium">Personal preferences</label>
        <Textarea
          value={personalPreferences}
          onChange={(e) => setPersonalPreferences(e.target.value)}
          rows={4}
          className="mt-1.5"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Custom instructions appended to all conversations
        </p>
      </div>

      <div className="border-t pt-6">
        <label className="text-sm font-medium">Setup</label>
        <p className="text-xs text-muted-foreground mt-1">
          Walk through the welcome steps again — name, provider and connectors.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={rerunSetup}>
          Run setup again
        </Button>
      </div>
    </div>
  )
}
