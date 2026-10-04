'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { APP_NAME } from '@/config/branding'
import { AlertCircle } from 'lucide-react'

type LoadState = 'loading' | 'loaded' | 'failed'

/**
 * One identity file. Loads, edits and saves — and says so when any of that fails.
 *
 * It used to swallow both directions: a failed load showed an EMPTY editor that
 * looked like "you have no SOUL.md yet", Save never checked the response and
 * always said "Saved!", and saving after a failed load wrote that empty editor
 * over the real ~/.claude/SOUL.md. Now a failed load blocks saving until a
 * retry succeeds, and a failed save says why.
 */
function IdentityFileEditor({
  id,
  label,
  description,
  apiPath,
  placeholder,
}: {
  id: string
  label: string
  description: string
  apiPath: string
  placeholder: string
}) {
  const [content, setContent] = useState('')
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadState('loading')
    setError(null)
    try {
      const res = await fetch(apiPath)
      if (!res.ok) {
        // The server's own words ("Could not read ~/.claude/SOUL.md (EACCES)")
        // say which file and why; a bare status code does not.
        const body = (await res.json().catch(() => ({}))) as { error?: unknown }
        throw new Error(typeof body.error === 'string' && body.error ? body.error : `Could not load ${label} (${res.status})`)
      }
      const d = (await res.json()) as { content?: unknown }
      if (typeof d.content !== 'string') throw new Error(`Could not load ${label}: unexpected response`)
      setContent(d.content)
      setLoadState('loaded')
    } catch (err) {
      setLoadState('failed')
      setError(err instanceof Error ? err.message : `Could not load ${label}`)
    }
  }, [apiPath, label])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSave() {
    // Never write what we did not successfully read: that is how an empty
    // editor replaced the real file.
    if (loadState !== 'loaded') return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: unknown }
        throw new Error(typeof d.error === 'string' && d.error ? d.error : `Save failed (${res.status})`)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(`Not saved — ${err instanceof Error ? err.message : 'the request failed'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {loadState === 'loading' ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-2 space-y-2">
          {loadState === 'loaded' && (
            <Textarea
              id={id}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={placeholder}
              rows={6}
              className="font-mono text-sm"
            />
          )}
          {error && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
          {loadState === 'failed' ? (
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          ) : (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function IdentitySection() {
  return (
    <div className="space-y-8">
      <IdentityFileEditor
        id="identity-soul-md"
        label="SOUL.md — assistant personality"
        description={`Defines ${APP_NAME}'s baseline personality. Injected first in every system prompt. Stored at ~/.claude/SOUL.md`}
        apiPath="/api/identity/soul-md"
        placeholder="You are a thoughtful, curious assistant who..."
      />
      <IdentityFileEditor
        id="identity-user-md"
        label="USER.md — about you"
        description={`Persistent context about you that ${APP_NAME} should always know. Stored at ~/.claude/USER.md`}
        placeholder="I'm a software engineer working on..."
        apiPath="/api/identity/user-md"
      />
    </div>
  )
}
