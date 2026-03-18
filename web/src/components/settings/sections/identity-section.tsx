'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

function IdentityFileEditor({
  label,
  description,
  apiPath,
  placeholder,
}: {
  label: string
  description: string
  apiPath: string
  placeholder: string
}) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(apiPath)
      .then((r) => r.json())
      .then((d) => { setContent(d.content || ''); setLoading(false) })
      .catch(() => setLoading(false))
  }, [apiPath])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {loading ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="mt-2 space-y-2">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={placeholder}
            rows={6}
            className="font-mono text-sm"
          />
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  )
}

export function IdentitySection() {
  return (
    <div className="space-y-8">
      <IdentityFileEditor
        label="SOUL.md — Assistant Personality"
        description="Defines the assistant's baseline personality. Injected first in every system prompt. Stored at ~/.claude/SOUL.md"
        apiPath="/api/identity/soul-md"
        placeholder="You are a thoughtful, curious assistant who..."
      />
      <IdentityFileEditor
        label="USER.md — User Context"
        description="Persistent context about you that the assistant should always know. Stored at ~/.claude/USER.md"
        placeholder="I'm a software engineer working on..."
        apiPath="/api/identity/user-md"
      />
    </div>
  )
}
