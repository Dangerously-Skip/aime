'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/config/branding'

/**
 * Profile. Two fields that used to sit here — "Work function", and the Cowork
 * section's one "Global instructions" box — were read by nothing at all; they
 * are removed (settings v13) rather than left looking like they did something.
 */
export function ProfileSection() {
  const setOnboardingComplete = useSettingsStore((s) => s.setOnboardingComplete)
  const setOnboardingSkippedAt = useSettingsStore((s) => s.setOnboardingSkippedAt)

  /**
   * The way back into setup, and the reason skipping can be permanent. The ONE
   * such button: Data & privacy had a second, "Restart setup wizard", whose
   * help text still offered to "change your team" — a feature that is gone.
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
  const personalPreferences = useSettingsStore((s) => s.personalPreferences)
  const setPersonalPreferences = useSettingsStore((s) => s.setPersonalPreferences)

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="profile-full-name" className="text-sm font-medium">Full name</label>
        <Input
          id="profile-full-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1.5"
        />
      </div>

      <div>
        <label htmlFor="profile-display-name" className="text-sm font-medium">Display name</label>
        <Input
          id="profile-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-1.5"
        />
        <p className="text-xs text-muted-foreground mt-1">
          What should {APP_NAME} call you?
        </p>
      </div>

      <div>
        <label htmlFor="profile-preferences" className="text-sm font-medium">Personal preferences</label>
        <Textarea
          id="profile-preferences"
          value={personalPreferences}
          onChange={(e) => setPersonalPreferences(e.target.value)}
          rows={4}
          className="mt-1.5"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Custom instructions added to Chat and Cowork conversations
        </p>
      </div>

      <div className="border-t pt-6">
        <h4 className="text-sm font-medium">Setup</h4>
        <p className="text-xs text-muted-foreground mt-1">
          Walk through the welcome steps again — name, model provider and connectors.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={rerunSetup}>
          Run setup again
        </Button>
      </div>
    </div>
  )
}
