'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettingsStore } from '@/stores/settings-store'
import { useProviderStore } from '@/stores/provider-store'
import { SEARCH_PROVIDERS, searchProviderPreset, type SearchProviderId } from '@/lib/search/providers'
import { resolveSearchRoute } from '@/lib/search/resolve'
import { deleteCredentials, saveCredentials, SEARCH_CREDENTIAL_ID } from '@/lib/models/credentials-client'
import { cn } from '@/lib/utils'
import { Check, Globe, Loader2, AlertCircle } from 'lucide-react'

/**
 * Where the user chooses a search provider.
 *
 * Search is opt-in and off by default. That is a deliberate product choice, not
 * an oversight: every provider is either a second account, a per-query cost, or
 * something you host. Turning one on for someone who did not ask would be
 * spending their money.
 *
 * The section shows the resolved state rather than the stored fields, because
 * those differ in the case that matters — a provider selected without its
 * credential is stored but does NOT resolve, and the app correctly behaves as
 * if search is off. Showing "Brave selected" there would be the same lie the
 * whole subsystem exists to remove.
 *
 * A search API key typed here goes to the encrypted credential store under
 * `search`, never into settings. It used to be a plain settings field — so it
 * sat in localStorage and rode along, in clear, on every chat request.
 */
export function SearchSection() {
  const {
    searchProvider,
    searchInstanceUrl,
    searchCredentialProviderId,
    setSearchProvider,
    setSearchInstanceUrl,
    setSearchCredentialProviderId,
  } = useSettingsStore()

  /**
   * A configured model provider whose key search can borrow.
   *
   * OpenRouter serves both inference and search, so anyone using it for models
   * has already supplied the credential. Asking for a second copy is what made
   * people skip setting search up at all — and an agent with no search is the
   * one that starts guessing URLs.
   */
  const borrowable = useProviderStore((s) =>
    s.providers.find((p) => p.enabled && p.presetId === 'openrouter' && p.hasCredentials),
  )

  const [keyDraft, setKeyDraft] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null)

  const preset = searchProvider && searchProvider !== 'none' ? searchProviderPreset(searchProvider) : undefined
  /*
   * The `defaults` argument matters here, and omitting it made this section
   * disagree with every turn.
   *
   * `useSearchSettings` sends `openrouterProviderId` on every request, so an
   * OpenRouter-only user has search ON by default and billed against their
   * inference key (~$0.005/query). Resolving without it here made Settings say
   * no card is selected, "Off by default", no config block, and a disabled
   * "Test search" button — the exact stored-vs-resolved divergence this
   * section's own doc comment claims it exists to display.
   */
  const route = resolveSearchRoute(
    { searchProvider, searchInstanceUrl, searchCredentialProviderId },
    {},
    { openrouterProviderId: borrowable?.id ?? null },
  )

  /** Which card reads as chosen: the explicit choice, else what resolves by default. */
  const activeId: SearchProviderId | 'none' | null =
    searchProvider ?? (route ? route.providerId : null)

  const usingBorrowed = !!borrowable && searchCredentialProviderId === borrowable.id
  const usingOwnKey = searchCredentialProviderId === SEARCH_CREDENTIAL_ID

  const select = (id: SearchProviderId | 'none' | null) => {
    setSearchProvider(id)
    // Default to borrowing when we can: the whole point is not asking twice.
    // A key saved for a different provider does not carry over — a Brave key is
    // not a Tavily key.
    setSearchCredentialProviderId(id === 'openrouter' && borrowable ? borrowable.id : null)
    setKeyDraft('')
    setKeyError(null)
    setTestResult(null)
  }

  const saveKey = async () => {
    const key = keyDraft.trim()
    if (!key) return
    setSavingKey(true)
    setKeyError(null)
    try {
      await saveCredentials(SEARCH_CREDENTIAL_ID, { apiKey: key })
      setSearchCredentialProviderId(SEARCH_CREDENTIAL_ID)
      setKeyDraft('')
      setTestResult(null)
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Could not store the key')
    } finally {
      setSavingKey(false)
    }
  }

  const removeKey = async () => {
    setKeyError(null)
    try {
      await deleteCredentials(SEARCH_CREDENTIAL_ID)
      setSearchCredentialProviderId(null)
      setTestResult(null)
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Could not remove the key')
    }
  }

  /**
   * A real search against the configured provider. Worth the round trip: the
   * failure this catches — credentials that look right and are not — is
   * otherwise discovered by an agent mid-task, where it reads as the model
   * being bad at research.
   */
  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/search-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'anthropic claude',
          max_results: 3,
          settings: { searchProvider, searchInstanceUrl, searchCredentialProviderId },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTestResult({
          ok: false,
          detail:
            data.error === 'auth'
              ? 'The provider rejected that API key.'
              : data.error === 'no_search_configured'
                ? 'Not configured yet.'
                : `The provider did not answer (${data.error ?? res.status}).`,
        })
      } else if (!data.results?.length) {
        setTestResult({ ok: false, detail: 'Connected, but returned no results.' })
      } else {
        setTestResult({ ok: true, detail: `Working — ${data.results.length} results.` })
      }
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : 'Request failed.' })
    } finally {
      setTesting(false)
    }
  }

  const card = (selected: boolean) =>
    cn(
      'w-full rounded-lg border p-3 text-left transition-colors',
      selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30',
    )

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Web search</h3>
        <p className="text-muted-foreground text-xs mt-1">
          Off by default. Without it the agent can read pages you give it a link to, but
          cannot look anything up — and is told to say so rather than guess.
        </p>
      </div>

      <div className="space-y-2" role="group" aria-label="Search provider">
        <button
          type="button"
          aria-pressed={activeId === 'none' || activeId === null}
          onClick={() => select('none')}
          className={card(activeId === 'none' || activeId === null)}
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">No search</span>
            {(activeId === 'none' || activeId === null) && (
              <Check className="ml-auto size-3.5 text-primary" aria-hidden="true" />
            )}
          </div>
          <div className="text-muted-foreground text-xs">
            The agent answers from what it knows and says what it could not check.
          </div>
        </button>

        {SEARCH_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={activeId === p.id}
            onClick={() => select(p.id)}
            className={card(activeId === p.id)}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{p.label}</span>
              {p.reusesModelCredential && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  no new account
                </span>
              )}
              {activeId === p.id && (
                <Check className="ml-auto size-3.5 shrink-0 text-primary" aria-hidden="true" />
              )}
            </div>
            <div className="text-muted-foreground text-xs mt-0.5">{p.description}</div>
          </button>
        ))}
      </div>

      {preset && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          {preset.requires.includes('apiKey') && usingBorrowed ? (
            <div className="flex items-start gap-2 rounded-md bg-emerald-500/5 p-2">
              <Check className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="text-xs">
                <div className="font-medium">Using your {borrowable.label} key</div>
                <div className="text-muted-foreground">
                  The same key already configured for models — no need to enter it again.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setSearchCredentialProviderId(null)}
                  >
                    Use a different key
                  </button>
                </div>
              </div>
            </div>
          ) : preset.requires.includes('apiKey') && usingOwnKey ? (
            <div className="flex items-start gap-2 rounded-md bg-emerald-500/5 p-2">
              <Check className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="text-xs">
                <div className="font-medium">API key saved</div>
                <div className="text-muted-foreground">
                  Encrypted on this machine, not kept in settings.{' '}
                  <button type="button" className="underline" onClick={() => setSearchCredentialProviderId(null)}>
                    Replace it
                  </button>
                  {' · '}
                  <button type="button" className="underline" onClick={() => void removeKey()}>
                    Remove it
                  </button>
                </div>
              </div>
            </div>
          ) : preset.requires.includes('apiKey') ? (
            <div className="space-y-1.5">
              <label htmlFor="search-api-key" className="block text-xs font-medium">
                API key
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="search-api-key"
                  type="password"
                  value={keyDraft}
                  placeholder={`${preset.label} API key`}
                  onChange={(e) => {
                    setKeyDraft(e.target.value)
                    setKeyError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveKey()
                  }}
                />
                <Button size="sm" onClick={() => void saveKey()} disabled={!keyDraft.trim() || savingKey}>
                  {savingKey ? <Loader2 className="size-3 animate-spin" /> : null}
                  Save key
                </Button>
              </div>
              <p className="text-muted-foreground text-[11px]">
                Stored encrypted on this machine with a key from your OS keychain.
              </p>
              {borrowable && searchProvider === 'openrouter' && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-xs underline"
                  onClick={() => setSearchCredentialProviderId(borrowable.id)}
                >
                  Use my {borrowable.label} key instead
                </button>
              )}
            </div>
          ) : null}

          {keyError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              {keyError}
            </p>
          )}

          {preset.requires.includes('instanceUrl') && (
            <div className="space-y-1">
              <label htmlFor="search-instance-url" className="block text-xs font-medium">
                Instance URL
              </label>
              <Input
                id="search-instance-url"
                value={searchInstanceUrl ?? ''}
                placeholder="https://searxng.example.com"
                onChange={(e) => {
                  setSearchInstanceUrl(e.target.value || null)
                  setTestResult(null)
                }}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={test} disabled={!route || testing}>
              {testing ? <Loader2 className="size-3 animate-spin" /> : <Globe className="size-3" />}
              Test search
            </Button>
            {preset.signupUrl && (
              <a
                href={preset.signupUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground text-xs underline"
              >
                {preset.requires.includes('apiKey') ? 'Get a key' : 'Setup guide'}
              </a>
            )}
          </div>

          {/*
            The resolved state, not the stored state. A provider chosen without
            its credential is saved but inactive, and saying so here is the
            whole point — the app behaves as if search is off, and the UI must
            agree with it.
          */}
          {!route && (
            <p className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5 text-xs">
              <AlertCircle className="size-3 shrink-0" />
              Not active yet — {preset.label} still needs its{' '}
              {preset.requires.map((r) => (r === 'apiKey' ? 'API key' : 'instance URL')).join(' and ')}.
              The agent is being told it has no search.
            </p>
          )}

          {testResult && (
            <p
              className={`flex items-center gap-1.5 text-xs ${
                testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {testResult.ok ? (
                <Check className="size-3 shrink-0" />
              ) : (
                <AlertCircle className="size-3 shrink-0" />
              )}
              {testResult.detail}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
