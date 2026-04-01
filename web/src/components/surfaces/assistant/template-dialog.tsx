"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { StandingOrderTemplate } from "@/lib/standing-order-templates";
import { useAssistantStore } from "@/stores/assistant-store";

interface TemplateDialogProps {
  template: StandingOrderTemplate;
  onClose: () => void;
}

export function TemplateDialog({ template, onClose }: TemplateDialogProps) {
  const addOrder = useAssistantStore((s) => s.addOrder);

  // Initialize params with defaults
  const [params, setParams] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const p of template.parameters || []) {
      defaults[p.key] = p.defaultValue;
    }
    return defaults;
  });

  const handleActivate = () => {
    const order = template.buildOrder(params);
    addOrder(order);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">{template.icon}</span>
            <h2 className="text-base font-semibold">{template.label}</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-muted-foreground">{template.description}</p>

          {template.parameters && template.parameters.length > 0 && (
            <div className="space-y-3">
              {template.parameters.map((param) => (
                <div key={param.key}>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    {param.label}
                  </label>
                  {param.type === 'select' && param.options ? (
                    <select
                      value={params[param.key] || param.defaultValue}
                      onChange={(e) => setParams({ ...params, [param.key]: e.target.value })}
                      className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {param.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : param.type === 'time' ? (
                    <input
                      type="time"
                      value={params[param.key] || param.defaultValue}
                      onChange={(e) => setParams({ ...params, [param.key]: e.target.value })}
                      className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  ) : param.type === 'number' ? (
                    <input
                      type="number"
                      value={params[param.key] || param.defaultValue}
                      onChange={(e) => setParams({ ...params, [param.key]: e.target.value })}
                      className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  ) : (
                    <input
                      type="text"
                      value={params[param.key] || param.defaultValue}
                      onChange={(e) => setParams({ ...params, [param.key]: e.target.value })}
                      className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleActivate}>Activate</Button>
        </div>
      </div>
    </div>
  );
}
