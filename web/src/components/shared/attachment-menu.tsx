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
  category: 'image' | 'document' | 'text' | 'spreadsheet' | 'presentation' | 'audio' | 'video'
  /** Set when file was uploaded via /api/upload (large files) */
  filePath?: string
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

export const FILE_ACCEPT = [
  "image/*",
  "application/pdf",
  ".docx,.doc",
  ".xlsx,.xls",
  ".pptx,.ppt",
  "audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/webm,.mp3,.wav,.m4a,.ogg",
  "video/mp4,video/quicktime,video/webm,video/x-msvideo,.mp4,.mov,.webm,.avi",
  ".txt,.md,.csv,.json,.xml,.js,.ts,.py,.go,.rs,.rb,.java,.c,.cpp,.h,.css,.html,.yml,.yaml,.toml,.sql,.sh,.log",
].join(",")

const SIZE_LIMITS: Record<string, number> = {
  image: 20 * 1024 * 1024,         // 20MB
  document: 50 * 1024 * 1024,      // 50MB
  text: 5 * 1024 * 1024,           // 5MB
  spreadsheet: 50 * 1024 * 1024,   // 50MB
  presentation: 50 * 1024 * 1024,  // 50MB
  audio: 100 * 1024 * 1024,        // 100MB
  video: 500 * 1024 * 1024,        // 500MB
}

/** Threshold above which files are uploaded via /api/upload instead of base64 in JSON body */
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

function classifyFile(file: File): 'image' | 'document' | 'text' | 'spreadsheet' | 'presentation' | 'audio' | 'video' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'document'
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) return 'document'
  if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) return 'spreadsheet'
  if (file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || file.name.endsWith('.pptx')) return 'presentation'
  if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|webm)$/i.test(file.name)) return 'audio'
  if (file.type.startsWith('video/') || /\.(mp4|mov|webm|avi)$/i.test(file.name)) return 'video'
  return 'text'
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  // Process in 8KB chunks to avoid stack overflow and string concatenation perf issues
  const chunks: string[] = []
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    const chunk = bytes.subarray(i, Math.min(i + 8192, bytes.byteLength))
    chunks.push(String.fromCharCode(...chunk))
  }
  return btoa(chunks.join(''))
}

/** Upload a large file via /api/upload and return the server path. */
async function uploadLargeFile(file: File, chatId?: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('chatId', chatId || `upload_${Date.now()}`)
  const res = await fetch('/api/upload', { method: 'POST', body: formData })
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`)
  const data = await res.json() as { path: string }
  return data.path
}

/** Process a FileList into AttachmentFile objects, calling onFile for each. */
export function processFiles(files: FileList, onFile: (file: AttachmentFile) => void, chatId?: string) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const category = classifyFile(file)
    const sizeLimit = SIZE_LIMITS[category]

    if (file.size > sizeLimit) {
      const limitMB = Math.round(sizeLimit / (1024 * 1024))
      alert(`File "${file.name}" exceeds the ${limitMB}MB size limit for ${category} files.`)
      continue
    }

    // Large files: upload via /api/upload, attach with filePath instead of content
    if (file.size > LARGE_FILE_THRESHOLD) {
      uploadLargeFile(file, chatId).then((filePath) => {
        onFile({
          name: file.name,
          content: '',
          type: file.type || 'application/octet-stream',
          category,
          filePath,
        })
      }).catch((err) => {
        alert(`Failed to upload "${file.name}": ${err.message}`)
      })
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
    } else if (category === 'text') {
      reader.onload = () => {
        onFile({
          name: file.name,
          content: reader.result as string,
          type: file.type || 'text/plain',
          category,
        })
      }
      reader.readAsText(file)
    } else {
      // Binary files (document, spreadsheet, presentation, audio, video): base64 encode
      reader.onload = () => {
        const base64 = arrayBufferToBase64(reader.result as ArrayBuffer)
        onFile({
          name: file.name,
          content: base64,
          type: file.type || 'application/octet-stream',
          category,
        })
      }
      reader.readAsArrayBuffer(file)
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
