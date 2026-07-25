"use client";

import { useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAssistantStore } from "@/stores/assistant-store";
import {
  X, Play, Pause, Trash2,
  Zap, CheckCircle2, AlertCircle,
} from "lucide-react";

type Tier = 'summary' | 'form' | 'json';

interface OrderEditorProps {
  orderId: string;
  onClose: () => void;
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

  // Form state (Tier 2)
  const [instruction, setInstruction] = useState(order?.instruction || '');
  const [triggerType, setTriggerType] = useState<'cron' | 'interval' | 'event'>(order?.trigger.type || 'interval');
  const [expression, setExpression] = useState(order?.trigger.expression || '');
  const [condition, setCondition] = useState(order?.condition || '');
  const [completionCondition, setCompletionCondition] = useState(order?.completionCondition || '');
  const [notifyVia, setNotifyVia] = useState(order?.notifyVia || 'assistant');

  if (!order) return null;

  const statusColor = {
    active: 'text-green-500',
    paused: 'text-yellow-500',
    completed: 'text-muted-foreground',
    expired: 'text-muted-foreground',
  }[order.status];

  const handleSaveForm = () => {
    updateOrder(orderId, {
      instruction,
      trigger: { type: triggerType as 'cron' | 'interval', expression },
      condition: condition || undefined,
      completionCondition: completionCondition || undefined,
      notifyVia,
    });
  };

  const handleSaveJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      updateOrder(orderId, parsed);
    } catch { /* ignore invalid JSON */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
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
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tier selector */}
        <div className="flex gap-1 px-5 py-2 border-b border-border/50 shrink-0">
          {(['summary', 'form', 'json'] as Tier[]).map((t) => (
            <button
              key={t}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                tier === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
              onClick={() => {
                setTier(t);
                if (t === 'json') setJsonText(JSON.stringify(order, null, 2));
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
                  <span className="text-xs font-medium text-muted-foreground">Trigger</span>
                  <p>{order.trigger.type}: {order.trigger.expression}</p>
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
                      <div key={a.id} className="text-xs text-muted-foreground">
                        {new Date(a.timestamp).toLocaleTimeString()} — {a.label}
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
                <label className="text-xs font-medium text-muted-foreground block mb-1">Instruction</label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 h-20 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Trigger type</label>
                  <select
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value as 'cron' | 'interval' | 'event')}
                    className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none"
                  >
                    <option value="cron">Cron</option>
                    <option value="interval">Interval</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Expression</label>
                  <input
                    type="text"
                    value={expression}
                    onChange={(e) => setExpression(e.target.value)}
                    placeholder={triggerType === 'cron' ? '0 9 * * 1-5' : '5m'}
                    className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Condition (optional)</label>
                <input
                  type="text"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="Only act when..."
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Completion condition (optional)</label>
                <input
                  type="text"
                  value={completionCondition}
                  onChange={(e) => setCompletionCondition(e.target.value)}
                  placeholder="Auto-complete when..."
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Notify via</label>
                <select
                  value={notifyVia}
                  onChange={(e) => setNotifyVia(e.target.value)}
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none"
                >
                  <option value="assistant">Assistant card feed</option>
                  <option value="toast">Desktop notification</option>
                  <option value="inject:code">Inject into Code surface</option>
                  <option value="inject:cowork">Inject into Cowork surface</option>
                </select>
              </div>
              <Button onClick={handleSaveForm} className="w-full">Save Changes</Button>
            </div>
          )}

          {tier === 'json' && (
            <div className="space-y-3">
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="w-full text-xs font-mono rounded-md border border-border bg-background px-3 py-2 h-64 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button onClick={handleSaveJson} className="w-full">Apply JSON</Button>
            </div>
          )}
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
          <Button variant="destructive" size="sm" onClick={() => { removeOrder(orderId); onClose(); }}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
