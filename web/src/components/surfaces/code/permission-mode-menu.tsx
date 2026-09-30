"use client";

import { Shield, Code2, FileText, AlertTriangle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import type { PermissionMode } from "@/stores/code-store";

/**
 * Every description is a claim the server enforces — `lib/security/permission-mode`,
 * proved by `claude-provider.permission-mode.test.ts` against the real
 * `canUseTool` and by `claude-provider.real-sdk.test.ts` against the real CLI.
 * Change a description and you are changing a security promise: change the
 * enforcement and its test with it.
 *
 * This list used to say "Always ask before making changes" for a mode the
 * server never received — it hard-coded auto-accept — so nobody was asked.
 */
export const PERMISSION_MODES: {
  value: PermissionMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: "default",
    icon: Shield,
    label: "Ask permissions",
    description: "Asks before every file edit and every command that could change something",
  },
  {
    value: "acceptEdits",
    icon: Code2,
    label: "Auto accept edits",
    description: "Edits the project folder and runs commands without asking; asks before editing outside it",
  },
  {
    value: "plan",
    icon: FileText,
    label: "Plan mode",
    description: "Reads and plans only: no file edits, no commands that change anything",
  },
  {
    value: "bypass",
    icon: AlertTriangle,
    label: "Bypass permissions",
    description: "Runs everything without asking. Your Security settings still apply",
  },
];

/** Code's permission-mode picker, in the composer toolbar. */
export function PermissionModeMenu({
  value,
  onChange,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}) {
  // PERMISSION_MODES[0] is the "default" (ask) mode, so it doubles as the fallback.
  const current = PERMISSION_MODES.find((m) => m.value === value) ?? PERMISSION_MODES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Permission mode: ${current.label}`}
            className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <current.icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{current.label}</span>
          </button>
        }
      />
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as PermissionMode)}>
          {PERMISSION_MODES.map((mode) => (
            <DropdownMenuRadioItem key={mode.value} value={mode.value} className="flex items-start gap-2 py-2">
              <mode.icon className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{mode.label}</span>
                <span className="text-xs text-muted-foreground">{mode.description}</span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
