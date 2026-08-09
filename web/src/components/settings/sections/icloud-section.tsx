'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, Loader2, Mail, X } from 'lucide-react'

/**
 * Connect iCloud Mail, Calendar and Contacts.
 *
 * Not on the Connectors screen because everything there is OAuth over HTTPS and
 * this is not: Apple publishes no API for user data, so the integration speaks
 * IMAP and DAV with an app-specific password. Presenting it as another OAuth
 * card would promise a "Connect" button that opens a browser, which is not what
 * happens.
 *
 * The password is posted once, verified against the real server, and stored
 * server-side in the encrypted credential store. It is never read back — the
 * field is left blank on return and the Apple ID alone is shown, so the user can
 * see which account is connected without the app holding a secret in the DOM.
 */
export function ICloudSection() {
  const [appleId, setAppleId] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [connected, setConnected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/icloud/connect')
      const data = await res.json()
      setConnected(data.connected ? data.appleId : null)
      if (data.appleId) setAppleId(data.appleId)
    } catch {
      // Not connected is the safe reading of an unreachable endpoint.
      setConnected(null)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/icloud/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appleId, appPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not connect.')
        return
      }
      setConnected(data.appleId)
      // Cleared on success: there is no reason for it to stay in memory, and a
      // populated field would imply the app is holding it for reuse.
      setAppPassword('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    await fetch('/api/icloud/connect', { method: 'DELETE' }).catch(() => {})
    setConnected(null)
    setAppPassword('')
    setBusy(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Mail className="h-4 w-4" />
          iCloud
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Mail, Calendar and Contacts. Reminders come through the calendar connection.
          Notes is not available — Apple keeps it on a private service with no API.
        </p>
      </div>

      {loaded && connected && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Connected
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{connected}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy}>
            <X className="mr-1 h-3.5 w-3.5" />
            Disconnect
          </Button>
        </div>
      )}

      <div>
        <label className="text-sm font-medium">Apple ID</label>
        <Input
          value={appleId}
          onChange={(e) => setAppleId(e.target.value)}
          placeholder="you@icloud.com"
          className="mt-1.5"
          autoComplete="username"
        />
      </div>

      <div>
        <label className="text-sm font-medium">App-specific password</label>
        <Input
          type="password"
          value={appPassword}
          onChange={(e) => setAppPassword(e.target.value)}
          placeholder="abcd-efgh-ijkl-mnop"
          className="mt-1.5"
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Not your Apple ID password — iCloud rejects that when two-factor authentication is
          on. Create one at{' '}
          <span className="font-mono">appleid.apple.com</span> → Sign-In and Security → App-Specific
          Passwords. It can be revoked on its own without changing your Apple ID password.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <Button onClick={connect} disabled={busy || !appleId || !appPassword} size="sm">
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        {connected ? 'Update credentials' : 'Connect'}
      </Button>

      <div className="border-t pt-4">
        <p className="text-xs text-muted-foreground">
          {/* Stated in the UI, not only in the code, because it is the thing a
              user most needs to be able to rely on. */}
          AIME can read your mail and write <strong>drafts</strong>. It cannot send —
          drafts wait in Mail for you to review and send yourself.
        </p>
      </div>
    </div>
  )
}
