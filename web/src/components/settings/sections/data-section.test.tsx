// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DataSection, exportFileName } from './data-section'
import { useSettingsStore } from '@/stores/settings-store'
import * as transcripts from '@/lib/transcripts/transcript-storage'

/**
 * Export wrote `useSettingsStore.getState()` verbatim — API key included — to
 * `open-claude-cowork-export.json` in Downloads.
 */

let exported: Blob | null
let downloadName: string | null

beforeEach(() => {
  exported = null
  downloadName = null
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
  URL.createObjectURL = vi.fn((b: Blob) => {
    exported = b
    return 'blob:x'
  }) as never
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloadName = this.download
  })
  useSettingsStore.setState({ anthropicApiKey: 'sk-ant-must-not-leak', fullName: 'Ada' } as never)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Export', () => {
  it('never includes an API key', async () => {
    render(<DataSection />)
    fireEvent.click(screen.getByRole('button', { name: /Export conversations/ }))
    await waitFor(() => expect(exported).not.toBeNull())
    // jsdom's Blob has no text()/stream(); FileReader is what it does support.
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.readAsText(exported!)
    })
    expect(text).not.toContain('sk-ant-must-not-leak')
    expect(text).not.toContain('anthropicApiKey')
    expect(JSON.parse(text).settings.fullName).toBe('Ada')
  })

  it('is named for the product and the day', () => {
    render(<DataSection />)
    fireEvent.click(screen.getByRole('button', { name: /Export conversations/ }))
    expect(downloadName).toMatch(/^aime-settings-\d{4}-\d{2}-\d{2}\.json$/)
    expect(exportFileName(new Date(2026, 8, 29))).toBe('aime-settings-2026-09-29.json')
  })
})

describe('Clear all data', () => {
  it('also clears the transcript database, which localStorage.clear() never reaches', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const clear = vi.spyOn(transcripts, 'clearAllTranscripts').mockReturnValue(new Promise(() => {}))
    render(<DataSection />)
    fireEvent.click(screen.getByRole('button', { name: /Clear everything/ }))
    expect(clear).toHaveBeenCalledTimes(1)
  })
})
