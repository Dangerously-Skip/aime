'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettingsStore } from '@/stores/settings-store'
import { useProviderStore } from '@/stores/provider-store'
import { SEARCH_PROVIDERS, searchProviderPreset, type SearchProviderId } from '@/lib/search/providers'
import { resolveSearchRoute } from '@/lib/search/resolve'
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
 */
export function SearchSection() {
  const {
    searchProvider,
    searchApiKey,
    searchInstanceUrl,
    searchCredentialProviderId,
    setSearchProvider,
    setSearchApiKey,
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

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null)

  const preset = searchProvider && searchProvider !== 'none' ? searchProviderPreset(searchProvider) : undefined
  const route = resolveSearchRoute({
    searchProvider,
    searchApiKey,
    searchInstanceUrl,
    searchCredentialProviderId,
  })

  const select = (id: SearchProviderId | 'none' | null) => {
    setSearchProvider(id)
    // Default to borrowing when we can: the whole point is not asking twice.
    setSearchCredentialProviderId(id === 'openrouter' && borrowable ? borrowable.id : null)
    setTestResult(null)
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
          settings: {
            searchProvider,
            searchApiKey,
            searchInstanceUrl,
            searchCredentialProviderId,
          },
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Web search</h3>
        <p className="text-muted-foreground text-xs mt-1">
          Off by default. Without it the agent can read pages you give it a link to, but
          cannot look anything up — and is told to say so rather than guess.
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => select('none')}
          className={`w-full text-left rounded-lg p-3 ring-1 transition ${
            searchProvider === 'none' ? 'ring-foreground/30 bg-foreground/5' : 'ring-foreground/10'
          }`}
        >
          <div className="font-medium text-sm">No search</div>
          <div className="text-muted-foreground text-xs">
            The agent answers from what it knows and says what it could not check.
          </div>
        </button>

        {SEARCH_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => select(p.id)}
            className={`w-full text-left rounded-lg p-3 ring-1 transition ${
              searchProvider === p.id ? 'ring-foreground/30 bg-foreground/5' : 'ring-foreground/10'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{p.label}</span>
              {p.reusesModelCredential && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  no new account
                </span>
              )}
            </div>
            <div className="text-muted-foreground text-xs mt-0.5">{p.description}</div>
          </button>
        ))}
      </div>

      {preset && (
        <div className="space-y-3 rounded-lg p-3 ring-1 ring-foreground/10">
          {preset.requires.includes('apiKey') && searchCredentialProviderId && borrowable ? (
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
          ) : preset.requires.includes('apiKey') ? (
            <div className="space-y-1">
              <label className="text-xs font-medium">API key</label>
              <Input
                type="password"
                value={searchApiKey ?? ''}
                placeholder={`${preset.label} API key`}
                onChange={(e) => {
                  setSearchApiKey(e.target.value || null)
                  setTestResult(null)
                }}
              />
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

          {preset.requires.includes('instanceUrl') && (
            <div className="space-y-1">
              <label className="text-xs font-medium">Instance URL</label>
              <Input
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
                Get a key
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
              {preset.requires.join(' and ')}. The agent is being told it has no search.
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
