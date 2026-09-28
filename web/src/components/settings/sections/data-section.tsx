'use client'

import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chat-store'
import { useCoworkStore } from '@/stores/cowork-store'
import { useCodeStore } from '@/stores/code-store'
import { useBrowserStore } from '@/stores/browser-store'
import { useConversationStore } from '@/stores/conversation-store'
import { useSettingsStore, exportableSettings } from '@/stores/settings-store'
import { APP_NAME } from '@/config/branding'
import { Download, Trash2, AlertTriangle } from 'lucide-react'

/** `aime-settings-2026-09-29.json` — named for the product and the day. */
export function exportFileName(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${APP_NAME.toLowerCase()}-settings-${y}-${m}-${d}.json`
}

/**
 * Data & privacy: export and deletion. Two things that used to be here live
 * elsewhere now — the per-surface cost table is in Usage & ROI (it was in
 * both), and "Restart setup wizard" duplicated Profile → "Run setup again"
 * while still offering to "change your team", a feature that is gone.
 */
export function DataSection() {
  const handleClearHistory = () => {
    const confirmed = window.confirm(
      'Are you sure you want to clear all conversation history? This action cannot be undone.'
    )
    if (!confirmed) return

    const chatMessages = useChatStore.getState().messages
    for (const chatId of Object.keys(chatMessages)) {
      useChatStore.getState().clearMessages(chatId)
    }

    const coworkMessages = useCoworkStore.getState().messages
    for (const chatId of Object.keys(coworkMessages)) {
      useCoworkStore.getState().clearMessages(chatId)
    }

    const codeMessages = useCodeStore.getState().messages
    for (const chatId of Object.keys(codeMessages)) {
      useCodeStore.getState().clearMessages(chatId)
    }

    const browserMessages = useBrowserStore.getState().messages
    for (const chatId of Object.keys(browserMessages)) {
      useBrowserStore.getState().clearMessages(chatId)
    }

    const conversations = useConversationStore.getState().conversations
    for (const conv of conversations) {
      useConversationStore.getState().removeConversation(conv.id)
    }
  }

  const handleClearAllData = () => {
    const confirmed = window.confirm(
      'WARNING: This will permanently delete ALL application data including settings, conversations, and preferences. This action cannot be undone. Are you absolutely sure?'
    )
    if (!confirmed) return

    localStorage.clear()
    window.location.reload()
  }

  const handleExport = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      // Never the raw store: it held API keys, and this file lands in Downloads.
      settings: exportableSettings(useSettingsStore.getState()),
      chat: useChatStore.getState(),
      cowork: useCoworkStore.getState(),
      code: useCodeStore.getState(),
      browser: useBrowserStore.getState(),
      conversations: useConversationStore.getState(),
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFileName()
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Export */}
      <div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          Export conversations
        </Button>
        <p className="text-xs text-muted-foreground mt-1">
          Download your conversations and settings as JSON. API keys are never included.
        </p>
      </div>

      {/* Destructive Actions */}
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger zone
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Clear conversation history</div>
            <p className="text-xs text-muted-foreground">
              Remove all messages from every surface
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleClearHistory}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear history
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Clear all data</div>
            <p className="text-xs text-muted-foreground">
              Permanently delete all settings, conversations, and preferences. Saved API
              keys live in the encrypted store and are not touched — remove providers
              in Models &amp; API keys first to delete those.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleClearAllData}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear everything
          </Button>
        </div>
      </div>
    </div>
  )
}
