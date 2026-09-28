"use client";

import { useState, useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAssistantStore, type StandingOrder } from "@/stores/assistant-store";
import { SchedulePicker, type ScheduleChange } from "@/components/schedule/schedule-picker";
import {
  describeTrigger,
  formatNextRun,
  nextRunForTrigger,
  validateTrigger,
  type Trigger,
} from "@/lib/schedule/schedule";
import { editableOrderJson, parseOrderEdit } from "@/lib/schedule/order-edit";
import {
  X, Play, Pause, Trash2,
  Zap, CheckCircle2, AlertCircle,
} from "lucide-react";

type Tier = 'summary' | 'form' | 'json';

interface OrderEditorProps {
  orderId: string;
  onClose: () => void;
}

/** Where a result lands. Every option also leaves a card in the feed. */
export const NOTIFY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'toast', label: 'Card + desktop notification' },
  { value: 'assistant', label: 'Card in the Assistant feed only' },
  { value: 'inject:code', label: 'Card + send to the Code surface' },
  { value: 'inject:cowork', label: 'Card + send to the Cowork surface' },
];

/** Confirm, then delete. Shared with the sidebar so both ask the same way. */
export function confirmDeleteOrder(order: Pick<StandingOrder, 'instruction'>): boolean {
  const name = order.instruction.length > 60 ? `${order.instruction.slice(0, 60)}…` : order.instruction;
  return window.confirm(`Delete the schedule "${name}"? It will stop running and its history in this list is lost.`);
}

export function OrderEditor({ orderId, onClose }: OrderEditorProps) {
  const order = useAssistantStore(
    useCallback((s) => s.orders.find((o) => o.id === orderId), [orderId]),
  );
  const { updateOrder, pauseOrder, resumeOrder, completeOrder, removeOrder } = useAssistantStore(
    useShallow((s) => ({
      updateOrder: s.updateOrder,
      pauseOrder: s.pauseOrder,
      resumeOrder: s.resumeOrder,
      completeOrder: s.completeOrder,
      removeOrder: s.removeOrder,
    })),
  );
  const activity = useAssistantStore(useShallow(
    (s) => s.activity.filter((a) => a.orderId === orderId),
  ));

  const [tier, setTier] = useState<Tier>('summary');
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** The save confirmation — announced, then cleared. */
  const [saved, setSaved] = useState(false);
  /** The preview clock, fixed while the dialog is open. */
  const [now] = useState(() => Date.now());

  // Form state (Tier 2)
  const [instruction, setInstruction] = useState(order?.instruction || '');
  /*
   * EVENT TRIGGERS ARE KEPT. The dropdown offered cron and interval only, and
   * saving cast the type to one of those — so opening an event-driven order and
   * pressing Save turned it into a schedule with no expression.
   */
  const [runsOn, setRunsOn] = useState<'schedule' | 'event'>(order?.trigger.type === 'event' ? 'event' : 'schedule');
  const [schedule, setSchedule] = useState<ScheduleChange>(() => ({
    trigger: order && order.trigger.type !== 'event' ? order.trigger : null,
    error: order && order.trigger.type !== 'event' ? validateTrigger(order.trigger) : null,
  }));
  const [eventName, setEventName] = useState(order?.trigger.event || '');
  const [condition, setCondition] = useState(order?.condition || '');
  const [completionCondition, setCompletionCondition] = useState(order?.completionCondition || '');
  const [notifyVia, setNotifyVia] = useState(order?.notifyVia || 'toast');

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  if (!order) return null;

  const statusColor = {
    active: 'text-green-500',
    paused: 'text-yellow-500',
    completed: 'text-muted-foreground',
    expired: 'text-muted-foreground',
  }[order.status];

  const next = nextRunForTrigger(order.trigger, order, now);
  const triggerError = validateTrigger(order.trigger);

  const handleSaveForm = () => {
    if (!instruction.trim()) {
      setError('Say what this should do');
      return;
    }
    let trigger: Trigger;
    if (runsOn === 'event') {
      if (!eventName.trim()) {
        setError('Name the event this runs on');
        return;
      }
      trigger = { type: 'event', event: eventName.trim() };
    } else {
      if (!schedule.trigger) {
        setError(schedule.error ?? 'Pick a schedule');
        return;
      }
      trigger = schedule.trigger;
    }
    setError(null);
    updateOrder(orderId, {
      instruction: instruction.trim(),
      trigger,
      condition: condition.trim() || undefined,
      completionCondition: completionCondition.trim() || undefined,
      notifyVia,
    });
    setSaved(true);
  };

  const handleSaveJson = () => {
    const result = parseOrderEdit(jsonText);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    updateOrder(orderId, result.patch);
    setSaved(true);
  };

  const handleDelete = () => {
    if (!confirmDeleteOrder(order)) return;
    removeOrder(orderId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit schedule"
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-lg mx-4 overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className={statusColor}>
              {order.status === 'active' ? <Zap className="h-4 w-4" /> :
               order.status === 'paused' ? <Pause className="h-4 w-4" /> :
               order.status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> :
               <AlertCircle className="h-4 w-4" />}
            </span>
            <h2 className="text-sm font-semibold truncate max-w-[300px]" title={order.instruction}>{order.instruction}</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tier selector */}
        <div className="flex gap-1 px-5 py-2 border-b border-border/50 shrink-0" role="tablist">
          {(['summary', 'form', 'json'] as Tier[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tier === t}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                tier === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
              onClick={() => {
                setTier(t);
                setError(null);
                if (t === 'json') setJsonText(editableOrderJson(order));
              }}
            >
              {t === 'summary' ? 'Summary' : t === 'form' ? 'Customize' : 'Advanced'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tier === 'summary' && (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-xs font-medium text-muted-foreground">Instruction</span>
                <p>{order.instruction}</p>
              </div>
              <div className="flex gap-4">
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Schedule</span>
                  <p className={triggerError ? 'text-red-600 dark:text-red-400' : undefined}>
                    {describeTrigger(order.trigger)}
                  </p>
                  {triggerError && <p className="text-xs text-red-600 dark:text-red-400">{triggerError}</p>}
                  {next !== null && (
                    <p className="text-xs text-muted-foreground">Next run: {formatNextRun(next, now)}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Runs in background — even with the window closed</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Status</span>
                  <p><Badge variant={order.status === 'active' ? 'default' : 'secondary'}>{order.status}</Badge></p>
                </div>
              </div>
              <div className="flex gap-4">
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Runs</span>
                  <p>{order.runCount}</p>
                </div>
                {order.errorCount > 0 && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">Errors</span>
                    <p className="text-red-600 dark:text-red-400">{order.errorCount}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Cost</span>
                  <p>${(order.totalCost || 0).toFixed(4)}</p>
                </div>
                {order.lastRun && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">Last run</span>
                    <p>{new Date(order.lastRun).toLocaleString()}</p>
                  </div>
                )}
              </div>
              {order.condition && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Condition</span>
                  <p>{order.condition}</p>
                </div>
              )}
              {order.lastResult && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Last result</span>
                  <p className="text-xs text-muted-foreground line-clamp-3">{order.lastResult}</p>
                </div>
              )}
              {Object.keys(order.state).length > 0 && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Accumulated state</span>
                  <pre className="text-xs bg-muted/50 rounded p-2 mt-1 overflow-x-auto">{JSON.stringify(order.state, null, 2)}</pre>
                </div>
              )}
              {activity.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Recent activity</span>
                  <div className="space-y-1 mt-1">
                    {activity.slice(0, 5).map((a) => (
                      <div
                        key={a.id}
                        className={`text-xs ${a.type === 'order-error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                      >
                        {new Date(a.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} — {a.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tier === 'form' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="order-instruction" className="text-xs font-medium text-muted-foreground block mb-1">Instruction</label>
                <textarea
                  id="order-instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 h-20 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="order-runs-on" className="text-xs font-medium text-muted-foreground block mb-1">Runs</label>
                <select
                  id="order-runs-on"
                  value={runsOn}
                  onChange={(e) => setRunsOn(e.target.value as 'schedule' | 'event')}
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none mb-2"
                >
                  <option value="schedule">On a schedule</option>
                  <option value="event">When an event happens</option>
                </select>
                {runsOn === 'schedule' ? (
                  <SchedulePicker
                    value={order.trigger.type === 'event' ? undefined : order.trigger}
                    onChange={setSchedule}
                    timing={order}
                  />
                ) : (
                  <input
                    type="text"
                    aria-label="Event name"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder="e.g. build-failed"
                    className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
              </div>
              <div>
                <label htmlFor="order-condition" className="text-xs font-medium text-muted-foreground block mb-1">Condition (optional)</label>
                <input
                  id="order-condition"
                  type="text"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="Only act when..."
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="order-completion" className="text-xs font-medium text-muted-foreground block mb-1">Completion condition (optional)</label>
                <input
                  id="order-completion"
                  type="text"
                  value={completionCondition}
                  onChange={(e) => setCompletionCondition(e.target.value)}
                  placeholder="Auto-complete when..."
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="order-notify" className="text-xs font-medium text-muted-foreground block mb-1">When it runs</label>
                <select
                  id="order-notify"
                  value={notifyVia}
                  onChange={(e) => setNotifyVia(e.target.value)}
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none"
                >
                  {NOTIFY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <Button onClick={handleSaveForm} className="w-full">Save Changes</Button>
            </div>
          )}

          {tier === 'json' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Editable fields only. Run counts and status belong to the scheduler.
              </p>
              <textarea
                aria-label="Schedule JSON"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="w-full text-xs font-mono rounded-md border border-border bg-background px-3 py-2 h-64 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                spellCheck={false}
              />
              <Button onClick={handleSaveJson} className="w-full">Apply JSON</Button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <p role="status" aria-live="polite" className="mt-3 text-xs text-emerald-600 dark:text-emerald-400 min-h-4">
            {saved ? 'Saved' : ''}
          </p>
        </div>

        {/* Footer actions */}
        <div className="flex justify-between px-5 py-3 border-t border-border shrink-0">
          <div className="flex gap-2">
            {order.status === 'active' && (
              <Button variant="ghost" size="sm" onClick={() => pauseOrder(orderId)}>
                <Pause className="h-3 w-3 mr-1" /> Pause
              </Button>
            )}
            {order.status === 'paused' && (
              <Button variant="ghost" size="sm" onClick={() => resumeOrder(orderId)}>
                <Play className="h-3 w-3 mr-1" /> Resume
              </Button>
            )}
            {(order.status === 'active' || order.status === 'paused') && (
              <Button variant="ghost" size="sm" onClick={() => completeOrder(orderId)}>
                <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
              </Button>
            )}
          </div>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
