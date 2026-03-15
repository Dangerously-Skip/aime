'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useMemoryStore } from '@/stores/memory-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useProjectStore } from '@/stores/project-store'
import { MEMORY_CATEGORIES, type MemoryCategory } from '@/lib/memory/types'
import { Brain, Search, Trash2, Edit2, Check, X } from 'lucide-react'

function CategoryBadge({ category }: { category: MemoryCategory }) {
  const colors: Record<MemoryCategory, string> = {
    preference: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    fact: 'bg-green-500/10 text-green-600 dark:text-green-400',
    pattern: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    decision: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    skill: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    relationship: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[category]}`}>
      {category}
    </span>
  )
}

function MemoryItem({
  memory,
  onDelete,
  onUpdate,
  projectName,
}: {
  memory: import('@/lib/memory/types').Memory
  onDelete: () => void
  onUpdate: (content: string) => void
  projectName?: string
}) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(memory.content)

  const handleSave = () => {
    if (editText.trim() && editText !== memory.content) {
      onUpdate(editText.trim())
    }
    setEditing(false)
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 group">
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="text-sm h-8"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleSave}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditing(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <p className="text-sm">{memory.content}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <CategoryBadge category={memory.category} />
          <span className="text-xs text-muted-foreground">
            {memory.source === 'auto' ? 'Auto' : 'Manual'}
          </span>
          {memory.scope === 'project' && projectName && (
            <span className="text-xs text-muted-foreground">
              {projectName}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {new Date(memory.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {!editing && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(true)}>
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function MemorySection() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<MemoryCategory | 'all'>('all')
  const [filterScope, setFilterScope] = useState<'all' | 'global' | 'project'>('all')

  const memories = useMemoryStore((s) => s.memories)
  const removeMemory = useMemoryStore((s) => s.removeMemory)
  const updateMemory = useMemoryStore((s) => s.updateMemory)
  const autoExtractMemories = useSettingsStore((s) => s.autoExtractMemories)
  const setAutoExtractMemories = useSettingsStore((s) => s.setAutoExtractMemories)
  const projects = useProjectStore((s) => s.projects)

  const filteredMemories = useMemo(() => {
    return memories
      .filter((m) => !m.supersededBy)
      .filter((m) => {
        if (filterCategory !== 'all' && m.category !== filterCategory) return false
        if (filterScope !== 'all' && m.scope !== filterScope) return false
        if (searchQuery) {
          const lower = searchQuery.toLowerCase()
          return (
            m.content.toLowerCase().includes(lower) ||
            m.tags.some((t) => t.toLowerCase().includes(lower))
          )
        }
        return true
      })
  }, [memories, filterCategory, filterScope, searchQuery])

  const activeCount = memories.filter((m) => !m.supersededBy).length
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  )

  const handleClearAll = () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete all memories? This cannot be undone.'
    )
    if (!confirmed) return
    for (const m of memories) {
      removeMemory(m.id)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-primary" />
        <div>
          <h3 className="text-sm font-medium">Memory</h3>
          <p className="text-xs text-muted-foreground">
            {activeCount} memories stored
          </p>
        </div>
      </div>

      {/* Auto-extraction toggle */}
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <div className="text-sm font-medium">Auto-extract memories</div>
          <p className="text-xs text-muted-foreground">
            Automatically learn preferences and facts from conversations
          </p>
        </div>
        <Switch
          checked={autoExtractMemories}
          onCheckedChange={setAutoExtractMemories}
        />
      </div>

      {/* Search and filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="pl-9 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {[{ value: 'all' as const, label: 'All' }, ...MEMORY_CATEGORIES].map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setFilterCategory(cat.value as MemoryCategory | 'all')}
                className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                  filterCategory === cat.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="w-px h-4 bg-border" />
          {(['all', 'global', 'project'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setFilterScope(scope)}
              className={`rounded-full px-2 py-0.5 text-xs capitalize transition-colors ${
                filterScope === scope
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {scope}
            </button>
          ))}
        </div>
      </div>

      {/* Memory list */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {filteredMemories.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {searchQuery ? 'No memories match your search' : 'No memories yet'}
          </p>
        ) : (
          filteredMemories.map((memory) => (
            <MemoryItem
              key={memory.id}
              memory={memory}
              projectName={memory.projectId ? projectMap.get(memory.projectId) || undefined : undefined}
              onDelete={() => removeMemory(memory.id)}
              onUpdate={(content) => updateMemory(memory.id, { content })}
            />
          ))
        )}
      </div>

      {/* Clear all */}
      {activeCount > 0 && (
        <div className="flex justify-end">
          <Button variant="destructive" size="sm" onClick={handleClearAll}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Clear all memories
          </Button>
        </div>
      )}
    </div>
  )
}
