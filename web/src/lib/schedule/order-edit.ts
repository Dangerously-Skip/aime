import { validateTrigger, type Trigger } from './schedule';

/**
 * What a user may change on a standing order by hand — and nothing else.
 *
 * The Advanced (JSON) tab used to `JSON.parse` whatever was typed and hand the
 * result straight to `updateOrder`, swallowing parse errors. So a typo did
 * nothing, silently, and a valid edit could set `status`, `runCount`,
 * `lastRun` or `id` — the counters the scheduler owns, or the key the manifest
 * sync matches on. Now the JSON shows the editable fields only, and applying it
 * either names what is wrong or produces a patch of exactly those fields.
 *
 * Pure, so it is tested without a DOM.
 */

export const EDITABLE_ORDER_FIELDS = [
  'instruction',
  'trigger',
  'condition',
  'completionCondition',
  'notifyVia',
  'agentName',
  'maxExecutions',
  'expiresAt',
] as const;

export type EditableOrderField = (typeof EDITABLE_ORDER_FIELDS)[number];

export interface OrderPatch {
  instruction?: string;
  trigger?: Trigger;
  condition?: string;
  completionCondition?: string;
  notifyVia?: string;
  agentName?: string;
  maxExecutions?: number;
  expiresAt?: number;
}

/** The JSON the Advanced tab starts from: editable fields only. */
export function editableOrderJson(order: Partial<Record<EditableOrderField, unknown>>): string {
  const view: Record<string, unknown> = {};
  for (const key of EDITABLE_ORDER_FIELDS) {
    if (order[key] !== undefined) view[key] = order[key];
  }
  return JSON.stringify(view, null, 2);
}

/** Where a result may be delivered. `inject:<surface>` targets a surface. */
export function isValidNotifyVia(v: unknown): v is string {
  return v === 'assistant' || v === 'toast' || (typeof v === 'string' && /^inject:[a-z]+$/.test(v));
}

export type OrderEditResult = { ok: true; patch: OrderPatch } | { ok: false; error: string };

const optionalText = (v: unknown) => v === undefined || v === null || typeof v === 'string';

/** Parse and check an Advanced edit. Never throws. */
export function parseOrderEdit(text: string): OrderEditResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JSON object' };
  }

  const input = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter((k) => !(EDITABLE_ORDER_FIELDS as readonly string[]).includes(k));
  if (unknownKeys.length) {
    return {
      ok: false,
      error: `${unknownKeys.join(', ')} cannot be edited here. Editable: ${EDITABLE_ORDER_FIELDS.join(', ')}`,
    };
  }

  const patch: OrderPatch = {};

  if ('instruction' in input) {
    if (typeof input.instruction !== 'string' || !input.instruction.trim()) {
      return { ok: false, error: 'instruction must be non-empty text' };
    }
    patch.instruction = input.instruction.trim();
  }

  if ('trigger' in input) {
    const t = input.trigger as Trigger | null;
    if (!t || typeof t !== 'object' || !['cron', 'interval', 'event'].includes(t.type)) {
      return { ok: false, error: 'trigger.type must be "cron", "interval" or "event"' };
    }
    const trigger: Trigger =
      t.type === 'event' ? { type: 'event', event: String(t.event ?? '') } : { type: t.type, expression: String(t.expression ?? '') };
    const err = validateTrigger(trigger);
    if (err) return { ok: false, error: `trigger: ${err}` };
    patch.trigger = trigger;
  }

  for (const key of ['condition', 'completionCondition', 'agentName'] as const) {
    if (!(key in input)) continue;
    if (!optionalText(input[key])) return { ok: false, error: `${key} must be text` };
    patch[key] = (input[key] as string | null | undefined)?.trim() || undefined;
  }

  if ('notifyVia' in input) {
    if (!isValidNotifyVia(input.notifyVia)) {
      return { ok: false, error: 'notifyVia must be "assistant", "toast" or "inject:<surface>"' };
    }
    patch.notifyVia = input.notifyVia;
  }

  if ('maxExecutions' in input) {
    const v = input.maxExecutions;
    if (v !== null && v !== undefined && !(Number.isInteger(v) && (v as number) > 0)) {
      return { ok: false, error: 'maxExecutions must be a positive whole number, or null' };
    }
    patch.maxExecutions = (v as number | null) ?? undefined;
  }

  if ('expiresAt' in input) {
    const v = input.expiresAt;
    if (v !== null && v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v > 0)) {
      return { ok: false, error: 'expiresAt must be a timestamp in milliseconds, or null' };
    }
    patch.expiresAt = (v as number | null) ?? undefined;
  }

  return { ok: true, patch };
}
