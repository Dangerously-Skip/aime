"use client";

import { useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProviderStore } from "@/stores/provider-store";
import { buildModelOptions, groupOptions, findOption, type BuiltinModel, type ModelOption } from "@/lib/models/client-options";

const BUILTINS: BuiltinModel[] = [
  { id: "opus", label: "Opus 4.7" },
  { id: "sonnet", label: "Sonnet 4.6" },
  { id: "haiku", label: "Haiku 4.5" },
];

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Richer callback carrying the full selected option (incl. `providerConfig`
   * for user-added-provider models). When provided, the selector also lists
   * the user's enabled provider models; otherwise it shows built-ins only,
   * preserving the original behaviour for surfaces not yet wired for it.
   */
  onSelectModel?: (opt: ModelOption) => void;
  className?: string;
}

export function ModelSelector({ value, onChange, onSelectModel, className }: ModelSelectorProps) {
  const providers = useProviderStore((s) => s.providers);

  // provider-store hydrates lazily (skipHydration); pull it in once so enabled
  // provider models are available to select.
  useEffect(() => {
    if (onSelectModel) void useProviderStore.persist.rehydrate();
  }, [onSelectModel]);

  const options = useMemo(
    () => buildModelOptions(BUILTINS, onSelectModel ? providers : []),
    [providers, onSelectModel],
  );
  const groups = useMemo(() => groupOptions(options), [options]);

  const handleChange = (v: string | null) => {
    if (!v) return;
    onChange(v);
    const opt = findOption(options, v);
    if (opt && onSelectModel) onSelectModel(opt);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className={`h-7 w-[130px] text-xs bg-card ${className}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.length <= 1
          ? options.map((o) => (
              <SelectItem key={o.id} value={o.id} className="text-xs">
                {o.label}
              </SelectItem>
            ))
          : groups.map((g) => (
              <SelectGroup key={g.group}>
                <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {g.group}
                </SelectLabel>
                {g.items.map((o) => (
                  <SelectItem key={o.id} value={o.id} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
      </SelectContent>
    </Select>
  );
}
