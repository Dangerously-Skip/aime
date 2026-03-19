"use client"

import { useRef } from "react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Paperclip, Globe, FolderPlus, Plus } from "lucide-react"
import { ProjectIcon } from "@/components/shared/project-icon"

export interface AttachmentFile {
  name: string
  content: string
  type: string
  category: 'image' | 'document' | 'text'
}

interface Project {
  id: string
  name: string
  icon: string
}

interface AttachmentMenuProps {
  onFileSelect: (file: AttachmentFile) => void
  onWebSearchToggle: () => void
  webSearchEnabled: boolean
  currentProjectId?: string | null
  onAddToProject?: (projectId: string) => void
  onNewProject?: () => void
  projects?: Project[]
  /** Hide the web search toggle (e.g. in surfaces where it's not supported) */
  hideWebSearch?: boolean
}

export const FILE_ACCEPT = "image/*,application/pdf,.txt,.md,.csv,.json,.xml,.js,.ts,.py,.go,.rs,.rb,.java,.c,.cpp,.h,.css,.html,.yml,.yaml,.toml,.sql,.sh,.log"

const SIZE_LIMITS = {
  image: 10 * 1024 * 1024,    // 10MB
  document: 32 * 1024 * 1024, // 32MB
  text: 1 * 1024 * 1024,      // 1MB
}

function classifyFile(file: File): 'image' | 'document' | 'text' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'document'
  return 'text'
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Process a FileList into AttachmentFile objects, calling onFile for each. */
export function processFiles(files: FileList, onFile: (file: AttachmentFile) => void) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const category = classifyFile(file)
    const sizeLimit = SIZE_LIMITS[category]

    if (file.size > sizeLimit) {
      const limitMB = Math.round(sizeLimit / (1024 * 1024))
      alert(`File "${file.name}" exceeds the ${limitMB}MB size limit for ${category} files.`)
      continue
    }

    const reader = new FileReader()

    if (category === 'image') {
      reader.onload = () => {
        onFile({
          name: file.name,
          content: reader.result as string,
          type: file.type || 'image/png',
          category,
        })
      }
      reader.readAsDataURL(file)
    } else if (category === 'document') {
      reader.onload = () => {
        const base64 = arrayBufferToBase64(reader.result as ArrayBuffer)
        onFile({
          name: file.name,
          content: base64,
          type: file.type || 'application/pdf',
          category,
        })
      }
      reader.readAsArrayBuffer(file)
    } else {
      reader.onload = () => {
        onFile({
          name: file.name,
          content: reader.result as string,
          type: file.type || 'text/plain',
          category,
        })
      }
      reader.readAsText(file)
    }
  }
}

export function AttachmentMenu({
  onFileSelect,
  onWebSearchToggle,
  webSearchEnabled,
  currentProjectId,
  onAddToProject,
  onNewProject,
  projects,
  hideWebSearch,
}: AttachmentMenuProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    processFiles(files, onFileSelect)
    e.target.value = ""
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            />
          }
        >
          <Paperclip className="h-4 w-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-[200px]">
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
            Add files or photos
          </DropdownMenuItem>

          {onAddToProject && projects && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderPlus className="h-4 w-4" />
                  {currentProjectId ? "Change project" : "Add to project"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => onAddToProject(project.id)}
                    >
                      <ProjectIcon icon={project.icon} className="h-4 w-4 text-muted-foreground" />
                      <span className={currentProjectId === project.id ? "font-semibold" : ""}>
                        {project.name}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  {onNewProject && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onNewProject}>
                        <Plus className="h-4 w-4" />
                        Start a new project
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}

          {!hideWebSearch && (
            <>
              <DropdownMenuSeparator />

              <DropdownMenuCheckboxItem
                checked={webSearchEnabled}
                onClick={onWebSearchToggle}
              >
                <Globe className="h-4 w-4" />
                Web search
              </DropdownMenuCheckboxItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
