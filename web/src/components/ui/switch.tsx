"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

interface SwitchProps {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
  /**
   * The switch's accessible name.
   *
   * This wrapper accepted no labelling prop at all, so every switch in the app
   * was an unnamed control: a screen reader announces "switch, on" with no idea
   * what it governs, and a test cannot find it by anything a user would
   * recognise. The settings panels put their text in a sibling paragraph, which
   * looks labelled and is not — nothing associates the two.
   */
  'aria-label'?: string
  /** For the `<label for>` case, where visible text already names it. */
  id?: string
}

function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  'aria-label': ariaLabel,
  id,
}: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      id={id}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[checked]:bg-primary data-[unchecked]:bg-input",
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
          "data-[checked]:translate-x-4 data-[unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
