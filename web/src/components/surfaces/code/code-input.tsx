"use client";

import { useRef, useState } from "react";
import { ModelSelector } from "@/components/shared/model-selector";
import { AttachmentMenu } from "@/components/shared/attachment-menu";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { VoiceButton } from "@/components/shared/voice-button";
import { CommandPicker, type CommandSuggestion } from "@/components/shared/command-picker";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUp,
  Square,
  Shield,
  Code2,
  FileText,
  AlertTriangle,
  X,
  ImageIcon,
  File,
} from "lucide-react";
import type { PermissionMode } from "@/stores/code-store";
import { getSlashSuggestions } from "@/lib/slash-commands";
import { useAtSuggestions, getAtQuery, removeAtQuery } from "@/hooks/use-at-suggestions";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { composerKeyAction } from "./composer-keys";

/** This surface's routing capability — a fixed property of the surface. */
const CAPABILITY = getSurfaceRoute("code").capability;

/* ── Permission mode config ── */
const PERMISSION_MODES: {
  value: PermissionMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: "default",
    icon: Shield,
    label: "Ask permissions",
    description: "Always ask before making changes",
  },
  {
    value: "acceptEdits",
    icon: Code2,
    label: "Auto accept edits",
    description: "Automatically accept all file edits",
  },
  {
    value: "plan",
    icon: FileText,
    label: "Plan mode",
    description: "Create a plan before making changes",
  },
  {
    value: "bypass",
    icon: AlertTriangle,
    label: "Bypass permissions",
    description: "Accepts all permissions",
  },
];

/** PERMISSION_MODES[0] is the "default" (ask) mode, so it doubles as the fallback. */
function getPermissionMode(mode: PermissionMode) {
  return PERMISSION_MODES.find((m) => m.value === mode) ?? PERMISSION_MODES[0];
}

/* ── Attachment chip icon ── */
function AttachmentIcon({ category }: { category: AttachmentFile["category"] }) {
  switch (category) {
    case "image":
      return <ImageIcon className="h-3 w-3" />;
    case "document":
      return <File className="h-3 w-3" />;
    default:
      return <FileText className="h-3 w-3" />;
  }
}

/* ── Input card (shared between empty & active states) ── */
export function CodeInput({
  value,
  onChange,
  onSubmit,
  onAbort,
  isStreaming,
  permissionMode,
  onPermissionModeChange,
  model,
  onSelectModel,
  placeholder,
  rows,
  minHeight,
  attachments,
  onAttachmentAdd,
  onAttachmentRemove,
  currentProjectId,
  onAddToProject,
  onNewProject,
  projects,
  onVoiceTranscript,
  planButton,
  goalToggle,
  goalBar,
  goalStatus,
  goalQuestion,
  cwd,
  onSlashCommand,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onAbort?: () => void;
  isStreaming: boolean;
  cwd?: string | null;
  onSlashCommand?: (text: string) => boolean;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  model: string;
  /** Legacy built-in enum setter; selections are recorded as routes now. */
  onModelChange?: (model: string) => void;
  onSelectModel?: (opt: import('@/lib/models/client-options').ModelOption) => void;
  placeholder: string;
  rows: number;
  minHeight: string;
  attachments: AttachmentFile[];
  onAttachmentAdd: (file: AttachmentFile) => void;
  onAttachmentRemove: (index: number) => void;
  currentProjectId?: string | null;
  onAddToProject?: (projectId: string) => void;
  onNewProject?: () => void;
  projects?: { id: string; name: string; icon: string }[];
  onVoiceTranscript?: (text: string) => void;
  planButton?: React.ReactNode;
  /** Goal-mode controls, following the planButton slot pattern. */
  goalToggle?: React.ReactNode;
  goalBar?: React.ReactNode;
  /**
   * Run status, under the composer.
   *
   * Not in the dockview panel, because that panel can fail to open — it threw
   * `invalid location` on a real run and took the surface down with it. Feedback
   * that a goal has started must not depend on a panel being placeable.
   */
  goalStatus?: React.ReactNode;
  /** The run's parked question, above the composer where the user is. */
  goalQuestion?: React.ReactNode;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Held as the config object (not a bare component) so the icon renders through
  // a stable module-level reference rather than a locally-created component.
  const permMode = getPermissionMode(permissionMode);
  const [cmdSuggestions, setCmdSuggestions] = useState<CommandSuggestion[]>([]);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(0);
  const { fileSuggestions, fetchAtSuggestions, clearAtSuggestions, resolveFileAsAttachment } =
    useAtSuggestions();

  const activeSuggestions: CommandSuggestion[] = cmdSuggestions.length > 0
    ? cmdSuggestions
    : fileSuggestions.map((f) => ({
        type: 'at' as const,
        value: f.path,
        label: '@' + f.name,
        description: undefined,
        meta: f.relative,
      }));

  function handleSelectSuggestion(s: CommandSuggestion) {
    if (s.type === 'slash') {
      onChange(s.value + ' ');
      setCmdSuggestions([]);
    } else {
      const newVal = removeAtQuery(value);
      onChange(newVal);
      clearAtSuggestions();
      resolveFileAsAttachment(s.value).then((att) => {
        if (att) onAttachmentAdd(att);
      });
    }
    setSelectedSuggestionIdx(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // An IME candidate being confirmed is not a command to the composer.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (activeSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIdx((i) => Math.min(i + 1, activeSuggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && activeSuggestions.length > 0)) {
        e.preventDefault();
        handleSelectSuggestion(activeSuggestions[selectedSuggestionIdx]);
        return;
      }
      if (e.key === 'Escape') {
        setCmdSuggestions([]);
        clearAtSuggestions();
        return;
      }
    }
    const action = composerKeyAction(
      { key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode },
      { isStreaming, hasText: !!value.trim() },
    );
    if (action === "default") return;
    e.preventDefault();
    if (action === "abort") {
      onAbort?.();
    } else if (action === "submit") {
      // Let parent handle slash commands
      if (onSlashCommand && onSlashCommand(value.trim())) return;
      onSubmit(value.trim());
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    onChange(val);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;

    // Slash suggestions
    setCmdSuggestions(
      getSlashSuggestions(val).map((cmd) => ({
        type: 'slash' as const,
        value: cmd.name,
        label: cmd.name,
        description: cmd.args,
        meta: cmd.description,
      }))
    );

    // @ suggestions
    const atQ = getAtQuery(val);
    if (atQ !== null && cwd) {
      fetchAtSuggestions(atQ, cwd);
    } else {
      clearAtSuggestions();
    }

    setSelectedSuggestionIdx(0);
  }

  function handleButtonClick() {
    if (isStreaming) {
      onAbort?.();
    } else if (value.trim()) {
      if (onSlashCommand && onSlashCommand(value.trim())) return;
      onSubmit(value.trim());
    }
  }

  return (
    <div>
    <CommandPicker
      suggestions={activeSuggestions}
      selectedIndex={selectedSuggestionIdx}
      onSelect={handleSelectSuggestion}
      onSelectedIndexChange={setSelectedSuggestionIdx}
    />
    {goalQuestion}
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {goalBar}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        className={`${minHeight} max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pb-0`}
        style={{ opacity: isStreaming ? 0.6 : 1 }}
      />

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-2">
          {attachments.map((att, i) => (
            <span
              key={`${att.name}-${i}`}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              <AttachmentIcon category={att.category} />
              <span className="max-w-[120px] truncate">{att.name}</span>
              <button
                onClick={() => onAttachmentRemove(i)}
                aria-label={`Remove ${att.name}`}
                className="ml-0.5 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2.5">
        {/* Left: attachment menu and permission mode */}
        <div className="flex items-center gap-1">
          <AttachmentMenu
            onFileSelect={onAttachmentAdd}
            onWebSearchToggle={() => {}}
            webSearchEnabled={false}
            currentProjectId={currentProjectId}
            onAddToProject={onAddToProject}
            onNewProject={onNewProject}
            projects={projects}
          />
          {onVoiceTranscript && <VoiceButton onTranscript={onVoiceTranscript} />}
          {planButton}
          {goalToggle}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <permMode.icon className="h-3.5 w-3.5" />
                  <span>{permMode.label}</span>
                </button>
              }
            />
            <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64">
              <DropdownMenuRadioGroup
                value={permissionMode}
                onValueChange={(v) => onPermissionModeChange(v as PermissionMode)}
              >
                {PERMISSION_MODES.map((mode) => (
                  <DropdownMenuRadioItem
                    key={mode.value}
                    value={mode.value}
                    className="flex items-start gap-2 py-2"
                  >
                    <mode.icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{mode.label}</span>
                      <span className="text-xs text-muted-foreground">{mode.description}</span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Right: model selector and send */}
        <div className="flex items-center gap-2">
          <ModelSelector
            value={model}
            onSelectModel={onSelectModel}
            capability={CAPABILITY}
            className="border-0 bg-transparent shadow-none h-6 w-auto text-muted-foreground"
          />
          <Button
            size="icon"
            className={`h-8 w-8 shrink-0 rounded-full ${
              isStreaming
                ? "bg-destructive hover:bg-destructive/80"
                : "bg-primary hover:bg-primary/80"
            }`}
            onClick={handleButtonClick}
            disabled={!isStreaming && !value.trim()}
            aria-label={isStreaming ? "Stop (Esc)" : "Send"}
            title={isStreaming ? "Stop (Esc)" : "Send"}
          >
            {isStreaming ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
    {goalStatus}
    </div>
  );
}


/** Everything a caller passes; the surface builds one of these for both of its composers. */
export type CodeInputProps = Parameters<typeof CodeInput>[0];
