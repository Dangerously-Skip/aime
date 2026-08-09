'use client'

import { useAppStore, type Theme } from '@/stores/app-store'
import { useSettingsStore, type ChatFont } from '@/stores/settings-store'
import { Sun, Moon, Monitor, Sparkles, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'

const themeOptions: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
  { value: 'system', label: 'Auto', icon: <Monitor className="h-4 w-4" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
  { value: 'zara', label: 'Zara', icon: <Sparkles className="h-4 w-4" /> },
  { value: 'max', label: 'Max', icon: <Terminal className="h-4 w-4" /> },
]

const fontOptions: {
  value: ChatFont
  label: string
  family: string
  style: React.CSSProperties
}[] = [
  {
    value: 'default',
    label: 'Default (Inter)',
    family: 'Inter',
    style: { fontFamily: 'Inter, sans-serif' },
  },
  {
    value: 'sans',
    label: 'Sans (System UI)',
    family: 'System UI',
    style: { fontFamily: 'system-ui, sans-serif' },
  },
  {
    value: 'mono',
    label: 'Mono (JetBrains Mono)',
    family: 'JetBrains Mono',
    style: { fontFamily: 'JetBrains Mono, monospace' },
  },
  {
    value: 'system',
    label: 'System',
    family: '-apple-system',
    style: { fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' },
  },
]

function ThemePreview({ value }: { value: Theme }) {
  if (value === 'light') {
    return (
      <div className="h-16 w-full rounded-md bg-[#F9F7F3] p-2">
        <div className="h-full w-full rounded bg-white" />
      </div>
    )
  }

  if (value === 'dark') {
    return (
      <div className="h-16 w-full rounded-md bg-[#262624] p-2">
        <div className="h-full w-full rounded bg-[#303032]" />
      </div>
    )
  }

  if (value === 'zara') {
    return (
      <div className="h-16 w-full rounded-md p-2" style={{ background: 'linear-gradient(135deg, #FFF0F5 0%, #FCE4F2 50%, #F8D0E8 100%)' }}>
        <div className="h-full w-full rounded" style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #FFF5FA 100%)', boxShadow: '0 0 8px rgba(233, 30, 140, 0.15)' }} />
      </div>
    )
  }

  if (value === 'max') {
    // The same colours the Code surface shows, so the swatch is a promise the
    // theme actually keeps.
    return (
      <div className="h-16 w-full rounded-md p-2" style={{ background: 'linear-gradient(135deg, #000c18 0%, #10192c 50%, #2b2b4a 100%)' }}>
        <div className="h-full w-full rounded" style={{ background: 'linear-gradient(135deg, #16213a 0%, #1e2a45 100%)', boxShadow: '0 0 8px rgba(217, 119, 86, 0.25)' }} />
      </div>
    )
  }

  // Auto: half light / half dark
  return (
    <div className="h-16 w-full rounded-md overflow-hidden flex">
      <div className="flex-1 bg-[#F9F7F3] p-2">
        <div className="h-full w-full rounded-l bg-white" />
      </div>
      <div className="flex-1 bg-[#262624] p-2">
        <div className="h-full w-full rounded-r bg-[#303032]" />
      </div>
    </div>
  )
}

export function AppearanceSection() {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const chatFont = useSettingsStore((s) => s.chatFont)
  const setChatFont = useSettingsStore((s) => s.setChatFont)

  return (
    <div className="space-y-8">
      {/* Color Mode */}
      <div>
        <h3 className="text-sm font-medium mb-3">Color mode</h3>
        <div className="grid grid-cols-4 gap-3">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={cn(
                'rounded-lg border-2 p-2 text-left transition-all hover:border-muted-foreground/30',
                theme === opt.value
                  ? 'border-primary ring-2 ring-primary'
                  : 'border-border'
              )}
            >
              <ThemePreview value={opt.value} />
              <div className="mt-2 flex items-center gap-1.5 px-0.5">
                {opt.icon}
                <span className="text-xs font-medium">{opt.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Font */}
      <div>
        <h3 className="text-sm font-medium mb-3">Chat font</h3>
        <div className="grid grid-cols-2 gap-3">
          {fontOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setChatFont(opt.value)}
              className={cn(
                'rounded-lg border-2 p-3 text-left transition-all hover:border-muted-foreground/30',
                chatFont === opt.value
                  ? 'border-primary ring-2 ring-primary'
                  : 'border-border'
              )}
            >
              <span className="text-xs font-medium text-muted-foreground">
                {opt.label}
              </span>
              <p className="mt-1.5 text-sm truncate" style={opt.style}>
                The quick brown fox jumps over the lazy dog
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
