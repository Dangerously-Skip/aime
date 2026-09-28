// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { CapabilitiesSection } from './capabilities-section'
import { SettingsNav } from '../settings-nav'
import { INITIAL_SETTINGS, PERSISTED_SETTINGS_KEYS } from '@/stores/settings-store'
import { friendlyToolLabel, friendlyToolLabels } from './tool-labels'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Settings controls that looked like settings and changed nothing.
 *
 * Code → Permission mode (the server always runs acceptEdits), Worktree location
 * and Branch prefix (read nowhere), Capabilities → Tool access mode (read
 * nowhere), and a per-surface "Model: sonnet" line that contradicted the tier
 * grid. This is the "toggle that does nothing" shape CLAUDE.md warns about, so
 * the guard is that they cannot quietly come back.
 */

const SURFACES = {
  surfaces: {
    cowork: {
      allowedTools: ['Read', 'mcp__aime__FetchUrl', 'mcp__web-search__web_search', 'spawn_agent'],
      model: 'sonnet',
      maxTurns: 50,
      maxBudgetUsd: 5,
      permissionMode: 'acceptEdits',
    },
  },
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(SURFACES), { status: 200 })),
  )
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Capabilities', () => {
  it('has no tool-access-mode control', async () => {
    render(<CapabilitiesSection />)
    await screen.findByText('Cowork', { exact: false })
    expect(screen.queryByText(/tool access mode/i)).toBeNull()
    expect(screen.queryByText('Load when needed')).toBeNull()
    expect(screen.queryByText('Always loaded')).toBeNull()
  })

  it('does not print a fixed model per surface', async () => {
    render(<CapabilitiesSection />)
    await screen.findByText('Max turns: 50')
    expect(screen.queryByText(/Model:/)).toBeNull()
    expect(screen.queryByText(/sonnet/i)).toBeNull()
  })

  it('shows friendly tool names, never the internal ones', async () => {
    render(<CapabilitiesSection />)
    await screen.findByText('Read web pages')
    expect(screen.getByText('Web search')).toBeTruthy()
    expect(screen.getByText('Sub-agents')).toBeTruthy()
    expect(screen.queryByText(/mcp__/)).toBeNull()
    expect(screen.queryByText('spawn_agent')).toBeNull()
  })

  it('names the push-to-talk switch', async () => {
    render(<CapabilitiesSection />)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Dictate with a global hotkey' })).toBeTruthy())
  })
})

describe('the Code section', () => {
  it('is gone from the nav', () => {
    render(<SettingsNav activeSection="profile" onSectionChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /^code$/i })).toBeNull()
  })

  it('has no component file to render a permission-mode picker from', () => {
    expect(fs.existsSync(path.join(__dirname, 'code-section.tsx'))).toBe(false)
  })
})

describe('the dead settings fields', () => {
  it('are neither in state nor persisted', () => {
    for (const key of ['toolAccessMode', 'codeWorktreeLocation', 'codeBranchPrefix']) {
      expect(INITIAL_SETTINGS).not.toHaveProperty(key)
      expect(PERSISTED_SETTINGS_KEYS as readonly string[]).not.toContain(key)
    }
  })
})

describe('friendlyToolLabel', () => {
  it('strips the MCP prefix whatever the server is called', () => {
    expect(friendlyToolLabel('mcp__aime__canvas')).toBe('Canvas')
    expect(friendlyToolLabel('mcp__web-search__web_search')).toBe('Web search')
  })

  it('humanises names it has no entry for', () => {
    expect(friendlyToolLabel('mcp__aime__SomethingNew')).toBe('Something new')
    expect(friendlyToolLabel('snake_case_tool')).toBe('Snake case tool')
  })

  it('collapses two internal names that mean the same thing', () => {
    expect(friendlyToolLabels(['WebSearch', 'mcp__aime__SearchWeb'])).toEqual(['Web search'])
  })
})
