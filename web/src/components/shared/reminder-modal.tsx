'use client';

import { useReminderStore } from '@/stores/reminder-store';
import { Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ReminderModal() {
  const pending = useReminderStore((s) => s.pending);
  const dismiss = useReminderStore((s) => s.dismissReminder);

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl border border-border bg-card shadow-2xl p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Bell className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Reminder</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              {pending.prompt}
            </p>
          </div>
          <button
            onClick={dismiss}
            className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Button onClick={dismiss} className="w-full">
          Got it
        </Button>
      </div>
    </div>
  );
}
