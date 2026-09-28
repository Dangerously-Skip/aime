// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SearchSection } from './search-section'
import { useSettingsStore } from '@/stores/settings-store'
import { useProviderStore } from '@/stores/provider-store'

/**
 * The search API key goes to the credential store, never into settings.
 *
 * It used to be a settings field: persisted to localStorage in clear, and sent
 * with every chat request by `useSearchSettings`.
 */

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  useSettingsStore.setState({
    searchProvider: null,
    searchInstanceUrl: null,
    searchCredentialProviderId: null,
  } as never)
  useProviderStore.setState({ providers: [] })
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function chooseTavilyAndType(key: string) {
  render(<SearchSection />)
  fireEvent.click(screen.getByRole('button', { name: /Tavily/ }))
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: key } })
  fireEvent.click(screen.getByRole('button', { name: /Save key/ }))
}

describe('saving a search key', () => {
  it('posts it to the credential store under `search` and keeps only the id in settings', async () => {
    chooseTavilyAndType('tvly-123')
    await waitFor(() => expect(useSettingsStore.getState().searchCredentialProviderId).toBe('search'))

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/models/providers/credentials')
    expect(JSON.parse(init.body as string)).toEqual({ providerId: 'search', values: { apiKey: 'tvly-123' } })
    expect(JSON.stringify(useSettingsStore.getState())).not.toContain('tvly-123')
    expect(await screen.findByText('API key saved')).toBeTruthy()
  })

  it('shows what to do when the store has no master key (503), and does not pretend it saved', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 503 }))
    chooseTavilyAndType('tvly-123')
    expect((await screen.findByRole('alert')).textContent).toMatch(/Restart the app/)
    expect(useSettingsStore.getState().searchCredentialProviderId).toBeNull()
  })
})

describe('the selected option', () => {
  it('is marked, so the choice is visible at a glance', () => {
    useSettingsStore.setState({ searchProvider: 'searxng' } as never)
    render(<SearchSection />)
    expect(screen.getByRole('button', { name: /SearXNG/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Tavily/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('reflects the default-on OpenRouter route when nothing was chosen', () => {
    useProviderStore.setState({
      providers: [
        { id: 'or-1', presetId: 'openrouter', label: 'OpenRouter', enabled: true, createdAt: 0, models: [], hasCredentials: true },
      ],
    })
    render(<SearchSection />)
    expect(screen.getByRole('button', { name: /OpenRouter web search/ }).getAttribute('aria-pressed')).toBe('true')
  })
})
