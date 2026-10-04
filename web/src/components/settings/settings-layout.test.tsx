// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { SettingsDialog, sectionComponents } from './settings-dialog'
import { SettingsNav, NAV_GROUPS } from './settings-nav'
import { ProfileSection } from './sections/profile-section'
import { DataSection } from './sections/data-section'
import { RoiSection, formatUsd, parseHourlyRate } from './sections/roi-section'
import { SecuritySection, EnforcementBadge } from './sections/security-section'
import { MemorySection } from './sections/memory-section'
import { AppearanceSection } from './sections/appearance-section'
import { useAppStore } from '@/stores/app-store'
import { useSettingsStore, INITIAL_SETTINGS } from '@/stores/settings-store'
import { APP_NAME } from '@/config/branding'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the Settings dialog', () => {
  it('has a FIXED height, so the nav does not move between sections', () => {
    useAppStore.setState({ settingsSection: 'profile' })
    render(<SettingsDialog open onOpenChange={() => {}} />)
    const popup = screen.getByRole('dialog')
    expect(popup.className).toMatch(/\bh-\[min\(80vh,640px\)\]/)
    expect(popup.className).not.toMatch(/\bmax-h-/)
  })

  it('keeps the close button out of the scrolling content', () => {
    useAppStore.setState({ settingsSection: 'profile' })
    render(<SettingsDialog open onOpenChange={() => {}} />)
    const close = screen.getByRole('button', { name: 'Close settings' })
    expect(screen.getByTestId('settings-content').contains(close)).toBe(false)
  })

  it('has a component for every nav entry', () => {
    for (const g of NAV_GROUPS) for (const item of g.items) expect(sectionComponents[item.id], item.id).toBeTruthy()
  })
})

describe('the nav', () => {
  it('leads with models, renamed for what it holds', () => {
    render(<SettingsNav activeSection="profile" onSectionChange={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0].textContent).toBe('Models & API keys')
    expect(screen.queryByText('API Access')).toBeNull()
  })

  it('groups Profile, Identity and Memory together', () => {
    const you = NAV_GROUPS.find((g) => g.items.some((i) => i.id === 'profile'))!
    expect(you.items.map((i) => i.id)).toEqual(['profile', 'identity', 'memory'])
  })

  it('marks the active section with aria-current', () => {
    render(<SettingsNav activeSection="memory" onSectionChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Memory' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-current')).toBeNull()
  })

  it('keeps Notifications, and drops the one-field Cowork section', () => {
    render(<SettingsNav activeSection="profile" onSectionChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cowork' })).toBeNull()
  })
})

describe('Profile', () => {
  it('labels are associated with their fields, and the copy names the product', () => {
    render(<ProfileSection />)
    expect(screen.getByLabelText('Full name')).toBeTruthy()
    expect(screen.getByLabelText('Display name')).toBeTruthy()
    expect(screen.getByLabelText('Personal preferences')).toBeTruthy()
    expect(screen.getByText(`What should ${APP_NAME} call you?`)).toBeTruthy()
    expect(screen.queryByText(/Claude/)).toBeNull()
  })

  it('has no fields that nothing reads', () => {
    render(<ProfileSection />)
    expect(screen.queryByText('Work function')).toBeNull()
    expect(INITIAL_SETTINGS).not.toHaveProperty('workFunction')
    expect(INITIAL_SETTINGS).not.toHaveProperty('coworkInstructions')
  })
})

describe('one of each', () => {
  it('only Profile restarts setup; Data no longer does (or mentions teams)', () => {
    render(<DataSection />)
    expect(screen.queryByText(/Restart setup wizard/)).toBeNull()
    expect(screen.queryByText(/team/i)).toBeNull()
    cleanup()
    render(<ProfileSection />)
    expect(screen.getByRole('button', { name: 'Run setup again' })).toBeTruthy()
  })

  it('cost tracking lives in Usage & ROI only', () => {
    render(<DataSection />)
    expect(screen.queryByText(/Cost tracking/i)).toBeNull()
    cleanup()
    render(<RoiSection />)
    expect(screen.getByText('API spend by surface')).toBeTruthy()
  })
})

describe('Usage & ROI', () => {
  it('shows the run log’s spend per surface — not zeros, not the last turn', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      surfaces: {
        chat: { inputTokens: 1500, outputTokens: 300, totalUsd: 0.015, runs: 2 },
        cowork: { inputTokens: 40_000, outputTokens: 3_000, totalUsd: 0.4, runs: 1 },
      },
      total: { inputTokens: 41_500, outputTokens: 3_300, totalUsd: 0.415, runs: 3 },
      runsConsidered: 4,
    })))
    render(<RoiSection />)
    const table = await screen.findByRole('table')
    const cowork = within(table).getByRole('row', { name: /cowork/i })
    expect(within(cowork).getByText('$0.40')).toBeTruthy()
    expect(within(cowork).getByText('40K')).toBeTruthy()
    // The headline stat is the same total, not a sum of per-conversation last turns.
    expect(screen.getAllByText('$0.42').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('last 4 runs')).toBeTruthy()
  })

  it('says so when there is no spend yet, and reports a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      surfaces: {}, total: { inputTokens: 0, outputTokens: 0, totalUsd: 0, runs: 0 }, runsConsidered: 0,
    })))
    render(<RoiSection />)
    expect(await screen.findByText(/No recorded spend yet/)).toBeTruthy()
    cleanup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    render(<RoiSection />)
    expect(await screen.findByText('Could not load API costs')).toBeTruthy()
  })

  it('clearing the hourly rate does not snap it back to 150', () => {
    useSettingsStore.setState({ devHourlyRate: 90 })
    render(<RoiSection />)
    const input = screen.getByLabelText('Developer hourly rate (USD)') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    expect(useSettingsStore.getState().devHourlyRate).toBe(90)
    fireEvent.change(input, { target: { value: '120' } })
    expect(useSettingsStore.getState().devHourlyRate).toBe(120)
  })

  it('formats money one way', () => {
    expect(formatUsd(12.3)).toBe('$12.30')
    expect(formatUsd(0.0042)).toBe('$0.0042')
    expect(formatUsd(0)).toBe('$0.00')
    expect(parseHourlyRate('')).toBeNull()
    expect(parseHourlyRate('0')).toBeNull()
    expect(parseHourlyRate('75')).toBe(75)
  })
})

describe('Security', () => {
  it('uses themed switches named by their labels', () => {
    render(<SecuritySection />)
    expect(screen.getByRole('switch', { name: 'Disable Bash tool' })).toBeTruthy()
    // (base-ui keeps a hidden form input behind each switch; no native box is exposed)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('does not show an active "enforced" badge on a toggle that is off', () => {
    const { rerender } = render(<EnforcementBadge enforcement="enforced" on={false} />)
    const badge = screen.getByTestId('enforcement-badge')
    expect(badge.textContent).toBe('Enforced when on')
    expect(badge.getAttribute('data-active')).toBe('false')
    rerender(<EnforcementBadge enforcement="enforced" on />)
    expect(screen.getByTestId('enforcement-badge').getAttribute('data-active')).toBe('true')
  })

  it('no longer claims the controls only inject prompt text', () => {
    render(<SecuritySection />)
    expect(screen.queryByText(/inject safety rules/)).toBeNull()
    expect(screen.queryByText(/Claude/)).toBeNull()
  })
})

describe('Memory', () => {
  it('has one selected "All" per labelled filter group, not two identical chips', () => {
    render(<MemorySection />)
    const type = screen.getByRole('group', { name: 'Filter by type' })
    const scope = screen.getByRole('group', { name: 'Filter by scope' })
    expect(within(type).getByRole('button', { name: 'All types' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(scope).getByRole('button', { name: 'All scopes' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
  })
})

describe('Appearance', () => {
  it('explains the two named themes', () => {
    render(<AppearanceSection />)
    expect(screen.getByText('Soft pink, light')).toBeTruthy()
    expect(screen.getByText('Deep navy with a warm accent')).toBeTruthy()
  })
})
