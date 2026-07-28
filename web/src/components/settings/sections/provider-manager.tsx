'use client'

import { useEffect, useMemo, useState } from 'react'
import { useProviderStore } from '@/stores/provider-store'
import { PROVIDER_PRESETS, getPreset, needsApiKey } from '@/lib/models/providers'
import type { ScannedModel } from '@/lib/models/providers'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, X, RefreshCw, Loader2, Boxes } from 'lucide-react'

/** Discover a provider's models via the scan endpoint. Never persists secrets. */
async function scanModels(
  presetId: string,
  opts: { apiKey?: string; baseUrl?: string; providerId?: string } = {},
): Promise<ScannedModel[]> {
  const res = await fetch('/api/models/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      presetId,
      apiKey: opts.apiKey || undefined,
      baseUrl: opts.baseUrl || undefined,
      providerId: opts.providerId || undefined,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`)
  return (data.models ?? []) as ScannedModel[]
}

/** Persist a provider's secret to the server-side keychain (never localStorage). */
async function saveCredentials(providerId: string, values: Record<string, string>): Promise<void> {
  const res = await fetch('/api/models/providers/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, values }),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.error || `Could not store key (${res.status})`)
  }
}

async function deleteCredentials(providerId: string): Promise<void> {
  await fetch('/api/models/providers/credentials', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId }),
  }).catch(() => {})
}

/** Which stored credential ids no provider claims. Ids only — never values. */
async function listCredentialIds(): Promise<string[]> {
  const res = await fetch('/api/models/providers/credentials')
  if (!res.ok) return []
  const data = (await res.json().catch(() => ({}))) as { providerIds?: string[] }
  return Array.isArray(data.providerIds) ? data.providerIds : []
}

/**
 * Credential records with no provider behind them. Onboarding used to mint a new
 * uuid on every "Save & verify", so the encrypted store accumulated a copy of
 * the key per attempt (~12 in one case) that nothing could ever read back.
 *
 * `'anthropic'` is reserved: the BYOK key is mirrored there under a fixed id for
 * unattended/server-side runs and is deliberately not a provider-store entry.
 *
 * Reported rather than swept automatically. These are secrets, and the failure
 * mode of an automatic sweep is losing every key the moment provider-store
 * hydration hiccups — which is exactly what the dev-port bug did to localStorage
 * a fortnight ago. A count and a button cost one click and can't do that.
 */
export function orphanCredentialIds(
  stored: string[],
  providers: ReadonlyArray<{ id: string }>,
): string[] {
  const claimed = new Set<string>(['anthropic', ...providers.map((p) => p.id)])
  return stored.filter((id) => !claimed.has(id))
}

export function ProviderManager() {
  const providers = useProviderStore((s) => s.providers)
  const addProvider = useProviderStore((s) => s.addProvider)
  const removeProvider = useProviderStore((s) => s.removeProvider)
  const setEnabled = useProviderStore((s) => s.setEnabled)
  const setModels = useProviderStore((s) => s.setModels)
  const setHasCredentials = useProviderStore((s) => s.setHasCredentials)

  const [orphans, setOrphans] = useState<string[]>([])

  // provider-store hydrates lazily (skipHydration). The orphan scan is chained
  // off that promise, never run beside it: comparing stored keys against an
  // un-hydrated (empty) provider list would report every key as an orphan.
  useEffect(() => {
    let cancelled = false
    void useProviderStore.persist
      .rehydrate()
      ?.then(listCredentialIds)
      .then((ids) => {
        if (!cancelled) setOrphans(orphanCredentialIds(ids, useProviderStore.getState().providers))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const [adding, setAdding] = useState(false)
  const [presetId, setPresetId] = useState('openrouter')
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // 'add' | providerId | null
  const [error, setError] = useState<string | null>(null)

  const preset = useMemo(() => getPreset(presetId), [presetId])

  function beginAdd() {
    const p = getPreset('openrouter')
    setPresetId('openrouter')
    setLabel(p?.label ?? '')
    setBaseUrl(p?.defaultBaseUrl ?? '')
    setApiKey('')
    setError(null)
    setAdding(true)
  }

  function onPresetChange(id: string) {
    const p = getPreset(id)
    setPresetId(id)
    setLabel(p?.label ?? '')
    setBaseUrl(p?.defaultBaseUrl ?? '')
  }

  async function handleAdd() {
    if (!preset) return
    setBusy('add')
    setError(null)
    const id = globalThis.crypto.randomUUID()
    const keyNeeded = needsApiKey(preset)
    try {
      // 1. Discover models (transient key). Fail fast before persisting anything.
      const models = preset.scan ? await scanModels(presetId, { apiKey, baseUrl }) : []

      // 2. Store the secret server-side (keychain) if the provider needs one.
      if (keyNeeded && apiKey.trim()) {
        await saveCredentials(id, { apiKey: apiKey.trim() })
      }

      // 3. Persist the (non-secret) provider config + kept models.
      addProvider({ id, presetId, label: label.trim() || preset.label, baseUrl: baseUrl.trim() || undefined, enabled: true, models })
      if (keyNeeded && apiKey.trim()) setHasCredentials(id, true)

      setAdding(false)
      setApiKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add provider')
    } finally {
      setBusy(null)
    }
  }

  async function handleRescan(providerId: string) {
    const p = providers.find((x) => x.id === providerId)
    if (!p) return
    setBusy(providerId)
    setError(null)
    try {
      // The secret is not exposed to the client; the server reads it back from
      // the keychain by providerId, so rescan works for key-required providers too.
      const models = await scanModels(p.presetId, { baseUrl: p.baseUrl, providerId })
      setModels(providerId, models)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rescan failed')
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove(providerId: string) {
    await deleteCredentials(providerId)
    removeProvider(providerId)
  }

  async function handlePurgeOrphans() {
    setBusy('orphans')
    try {
      await Promise.all(orphans.map(deleteCredentials))
      setOrphans([])
    } finally {
      setBusy(null)
    }
  }

  function removeModel(providerId: string, modelId: string) {
    const p = providers.find((x) => x.id === providerId)
    if (!p) return
    setModels(providerId, p.models.filter((m) => m.id !== modelId))
  }

  return (
    <div className="border rounded-lg p-6 bg-card space-y-4">
      <div className="flex items-center gap-2">
        <Boxes className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-medium">Model Providers</h4>
        {!adding && (
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={beginAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add provider
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Bring your own models — OpenRouter, OpenAI, Groq, a local Ollama/LM Studio endpoint, and more.
        Keys are stored in your OS keychain, never in the browser.
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {adding && (
        <div className="rounded-lg border border-border/70 p-4 space-y-3 bg-background/40">
          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <label className="text-xs text-muted-foreground">Provider</label>
            <Select value={presetId} onValueChange={(v) => v && onPresetChange(v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 text-xs" placeholder={preset?.label} />

            <label className="text-xs text-muted-foreground">Base URL</label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-8 text-xs font-mono" placeholder={preset?.defaultBaseUrl} />

            {preset && needsApiKey(preset) && (
              <>
                <label className="text-xs text-muted-foreground">API key</label>
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="h-8 text-xs font-mono" placeholder="sk-..." />
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={busy === 'add' || (!!preset && needsApiKey(preset) && !apiKey.trim())}>
              {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Add &amp; scan
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)} disabled={busy === 'add'}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {providers.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground/70 italic">No custom providers yet.</p>
      )}

      <div className="space-y-3">
        {providers.map((p) => (
          <div key={p.id} className="rounded-lg border border-border/70 p-3.5 space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEnabled(p.id, !p.enabled)}
                title={p.enabled ? 'Disable' : 'Enable'}
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${p.enabled ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
              />
              <span className="text-sm font-medium">{p.label}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{getPreset(p.presetId)?.label ?? p.presetId}</span>
              <span className="text-xs text-muted-foreground">· {p.models.length} model{p.models.length === 1 ? '' : 's'}</span>
              <div className="ml-auto flex items-center gap-1">
                {getPreset(p.presetId)?.scan && (
                  <Button size="icon" variant="ghost" className="h-6 w-6" title="Rescan models" onClick={() => handleRescan(p.id)} disabled={busy === p.id}>
                    {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-6 w-6 hover:text-destructive" title="Remove provider" onClick={() => handleRemove(p.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {p.models.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-4">
                {p.models.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]">
                    {m.label || m.id}
                    <button onClick={() => removeModel(p.id, m.id)} className="text-muted-foreground hover:text-destructive" title="Remove model">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {orphans.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {orphans.length} stored key{orphans.length === 1 ? '' : 's'} belong to providers that no
            longer exist. Nothing can read {orphans.length === 1 ? 'it' : 'them'}.
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 shrink-0 text-xs hover:text-destructive"
            onClick={handlePurgeOrphans}
            disabled={busy === 'orphans'}
          >
            {busy === 'orphans' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            Delete {orphans.length === 1 ? 'it' : 'them'}
          </Button>
        </div>
      )}
    </div>
  )
}
