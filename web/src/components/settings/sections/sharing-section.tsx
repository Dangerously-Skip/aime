'use client'

import { useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { S3_PRESETS } from '@/lib/publish/s3-storage'
import { DECK_STORAGE_CREDENTIAL_ID } from '@/lib/models/credential-ids'
import { saveCredentials } from '@/lib/models/credentials-client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'

/**
 * Where "Share" publishes a deck.
 *
 * Two tiers, and the difference between them is not convenience — it is what
 * can be PROMISED:
 *
 *   Google Drive   named people, enforced by Google at request time
 *   a bucket       an unguessable link, and nothing more
 *
 * Both are offered, and the second says plainly what it cannot do. A "restrict
 * to people" control that silently produced a long URL would be the shape of
 * bug this codebase keeps finding, with someone's private data attached.
 *
 * The SECRET key never lands in this store: it goes straight to the encrypted
 * credential store under `deck-storage` and is read server-side at publish
 * time. Everything held here is an identifier.
 */
export function SharingSection() {
  const deckStorage = useSettingsStore((s) => s.deckStorage)
  const setDeckStorage = useSettingsStore((s) => s.setDeckStorage)

  const [preset, setPreset] = useState(deckStorage?.preset ?? 'r2')
  const [endpoint, setEndpoint] = useState(deckStorage?.endpoint ?? '')
  const [bucket, setBucket] = useState(deckStorage?.bucket ?? '')
  const [region, setRegion] = useState(deckStorage?.region ?? '')
  const [accessKeyId, setAccessKeyId] = useState(deckStorage?.accessKeyId ?? '')
  const [publicBaseUrl, setPublicBaseUrl] = useState(deckStorage?.publicBaseUrl ?? '')
  const [secret, setSecret] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const chosen = S3_PRESETS.find((p) => p.id === preset) ?? S3_PRESETS[0]

  async function save() {
    setBusy(true)
    setStatus(null)
    try {
      if (secret.trim()) {
        // Throws with a "restart the app" message on a 503 (no master key).
        await saveCredentials(DECK_STORAGE_CREDENTIAL_ID, { secretAccessKey: secret.trim() })
      }
      setDeckStorage({ preset, endpoint: endpoint.trim(), bucket: bucket.trim(), region: region.trim(), accessKeyId: accessKeyId.trim(), publicBaseUrl: publicBaseUrl.trim() })
      // Cleared from component state the moment it is stored — there is no
      // reason for it to sit in a React tree for the rest of the session.
      setSecret('')
      setStatus('Saved. The secret key is encrypted on disk, not in settings.')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const field = 'h-8 text-sm'

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Sharing a deck</h3>
        <p className="text-xs text-muted-foreground">
          Every deck can be exported as a single self-contained file with no setup at all — that is
          the Export button on any deck. The options below add a link.
        </p>
      </section>

      <section className="space-y-2 rounded-md border border-border p-3">
        <h4 className="text-sm font-medium">Google Drive</h4>
        <p className="text-xs text-muted-foreground">
          Uses the Google connector you have already set up — no extra configuration. It is the only
          option that can restrict a deck to <strong>named people</strong>: Google checks who is
          asking, so the restriction is real. Recipients need a Google account.
        </p>
      </section>

      <section className="space-y-3 rounded-md border border-border p-3">
        <div>
          <h4 className="text-sm font-medium">Your own storage bucket</h4>
          <p className="text-xs text-muted-foreground">
            Gives you a link on your own domain. A bucket has no way to check who is asking, so this
            can only ever produce a link that <strong>anyone holding it can open</strong> — the URL
            is unguessable, but it is not access control. Use Drive if you need to limit who can see
            a deck.
          </p>
        </div>

        <div className="space-y-1">
          <span id="sharing-provider-label" className="block text-xs text-muted-foreground">Provider</span>
          <Select
            value={preset}
            onValueChange={(v) => {
              if (!v) return
              const next = S3_PRESETS.find((p) => p.id === v)
              setPreset(v)
              if (next?.region) setRegion(next.region)
            }}
          >
            <SelectTrigger aria-labelledby="sharing-provider-label" className="h-8 w-full text-sm">
              <span className="truncate">{chosen.label}</span>
            </SelectTrigger>
            <SelectContent>
              {S3_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-sm">{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="block text-xs text-muted-foreground">{chosen.note}</span>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Endpoint</span>
          <Input className={field} value={endpoint} placeholder={chosen.endpointHint} onChange={(e) => setEndpoint(e.target.value)} />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Bucket</span>
            <Input className={field} value={bucket} onChange={(e) => setBucket(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Region</span>
            <Input className={field} value={region} placeholder="auto" onChange={(e) => setRegion(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Access key ID</span>
            <Input className={field} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Secret access key</span>
            <Input
              className={field}
              type="password"
              value={secret}
              placeholder={deckStorage ? '•••••••• (saved)' : ''}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Public base URL</span>
          <Input className={field} value={publicBaseUrl} placeholder="https://decks.example.com" onChange={(e) => setPublicBaseUrl(e.target.value)} />
          <span className="block text-xs text-muted-foreground">
            Where the bucket is readable from. On R2 this is not the endpoint — without it the link
            works only for you.
          </span>
        </label>

        <Button size="sm" variant="outline" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
      </section>
    </div>
  )
}
