"use client"

import { useState, useRef, useEffect } from "react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Pencil, Trash2 } from "lucide-react"
import { ProjectIcon } from "@/components/shared/project-icon"

interface ChatTitleBarProps {
  title: string
  onRename: (newTitle: string) => void
  onDelete: () => void
  projectName?: string | null
  projectIcon?: string | null
  onProjectClick?: () => void
}

export function ChatTitleBar({
  title,
  onRename,
  onDelete,
  projectName,
  projectIcon,
  onProjectClick,
}: ChatTitleBarProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- must run after mount: re-seeds the input and pairs with the focus/select below
      setRenameValue(title)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [isRenaming, title])

  function commitRename() {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== title) {
      onRename(trimmed)
    }
    setIsRenaming(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      commitRename()
    } else if (e.key === "Escape") {
      setIsRenaming(false)
    }
  }

  if (isRenaming) {
    return (
      <div className="flex items-center py-2 px-4">
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          className="bg-transparent border border-border rounded-md px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary max-w-[300px] w-full"
        />
      </div>
    )
  }

  return (
    <div className="flex items-center py-2 px-4">
      {/* Breadcrumb: Project / Chat Title v */}
      <div className="flex items-center gap-0 min-w-0">
        {projectName && onProjectClick && (
          <>
            <button
              onClick={onProjectClick}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px] shrink-0"
            >
              {projectIcon && <ProjectIcon icon={projectIcon} className="h-3.5 w-3.5" />}
              {projectName}
            </button>
            <span className="text-sm text-muted-foreground mx-2 shrink-0">/</span>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors outline-none min-w-0">
            <span className="truncate max-w-[250px]">{title}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" sideOffset={4}>
            <DropdownMenuItem onClick={() => setIsRenaming(true)}>
              <Pencil className="h-4 w-4" />
              Rename
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
