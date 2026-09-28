// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IdentitySection } from './identity-section'

/**
 * The identity editor failed silently both ways — and one of those ways
 * destroyed data: a failed load showed an empty editor, and Save then wrote
 * that emptiness over ~/.claude/SOUL.md while announcing "Saved!".
 */

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
let handler: Handler
const fetchMock = vi.fn((url: string, init?: RequestInit) => handler(url, init))
const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')

beforeEach(() => {
  fetchMock.mockClear()
  handler = () => Response.json({ content: 'I am SOUL' })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('loading', () => {
  it('shows the file when it loads', async () => {
    render(<IdentitySection />)
    expect(((await screen.findByLabelText(/SOUL\.md/)) as HTMLTextAreaElement).value).toBe('I am SOUL')
  })

  it('says a load failed instead of showing an empty editor, and offers a retry', async () => {
    handler = () => new Response('boom', { status: 500 })
    render(<IdentitySection />)
    expect((await screen.findAllByRole('alert'))[0].textContent).toMatch(/Could not load SOUL\.md/)
    expect(screen.queryByLabelText(/SOUL\.md/)).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0)
  })

  it('shows the server’s reason when the file cannot be read', async () => {
    handler = () => Response.json({ error: 'Could not read ~/.claude/SOUL.md (EACCES).' }, { status: 500 })
    render(<IdentitySection />)
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent)).toContain('Could not read ~/.claude/SOUL.md (EACCES).')
  })

  it('never lets a failed load be saved over the real file', async () => {
    handler = (url, init) =>
      init?.method === 'POST' ? Response.json({ ok: true }) : new Response('boom', { status: 500 })
    render(<IdentitySection />)
    await screen.findAllByRole('alert')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(posts()).toHaveLength(0)
  })

  it('recovers on retry', async () => {
    let fail = true
    handler = () => (fail ? new Response('boom', { status: 500 }) : Response.json({ content: 'back' }))
    render(<IdentitySection />)
    await screen.findAllByRole('alert')
    fail = false
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    expect(((await screen.findByLabelText(/SOUL\.md/)) as HTMLTextAreaElement).value).toBe('back')
  })
})

describe('saving', () => {
  it('reports a failed save rather than "Saved"', async () => {
    handler = (url, init) =>
      init?.method === 'POST'
        ? Response.json({ error: 'EACCES: permission denied' }, { status: 500 })
        : Response.json({ content: 'x' })
    render(<IdentitySection />)
    await screen.findByLabelText(/SOUL\.md/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect((await screen.findByRole('alert')).textContent).toMatch(/Not saved — EACCES/)
    expect(screen.queryByRole('button', { name: 'Saved' })).toBeNull()
  })

  it('says Saved only when the server said ok', async () => {
    handler = (url, init) => (init?.method === 'POST' ? Response.json({ ok: true }) : Response.json({ content: 'x' }))
    render(<IdentitySection />)
    await screen.findByLabelText(/SOUL\.md/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy())
  })
})
