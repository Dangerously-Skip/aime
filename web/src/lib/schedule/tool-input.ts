/**
 * Save-time validation for the schedules the MODEL creates — `StandingOrderCreate`
 * and `CronCreate` on the in-process aime MCP server.
 *
 * Both tools used to accept any string as a schedule and report success, so a
 * model that wrote `0 9 * * MON-FRY` or `every 2 hours` told the user "Standing
 * order created" for a job the tickers could never fire. The picker and the
 * order editor already refuse those with `validateTrigger`; this is the same
 * check at the third door, so the model gets the reason back as a tool error
 * and can correct itself instead of the user finding out by waiting.
 *
 * Pure, so it is safe on the server and trivially testable.
 */
import { validateTrigger, type Trigger } from './schedule';

/**
 * The trigger types the scheduler actually fires. `event` exists in the data
 * model, but nothing raises events yet (`isJobDue` returns false for them), so
 * offering it to the model would create orders that never run.
 */
export const MODEL_TRIGGER_TYPES = ['cron', 'interval'] as const;
export type ModelTriggerType = (typeof MODEL_TRIGGER_TYPES)[number];

/** What each accepts, in the words used in tool descriptions and errors. */
export const TRIGGER_EXPRESSION_HELP =
  'cron: 5 fields, minute hour day-of-month month day-of-week (e.g. "0 9 * * 1-5" = weekdays at 9:00, ' +
  '"*/15 * * * *" = every 15 minutes); interval: a duration like "5m", "90 minutes", "2h" or "1d".';

export interface StandingOrderToolInput {
  instruction?: unknown;
  trigger_type?: unknown;
  expression?: unknown;
  maxExecutions?: unknown;
  expiresInHours?: unknown;
}

/** Null when the order can be saved; otherwise one sentence saying why not. */
export function validateStandingOrderInput(input: StandingOrderToolInput): string | null {
  if (typeof input.instruction !== 'string' || !input.instruction.trim()) {
    return 'The instruction is empty — say what the order should do when it fires.';
  }
  if (!MODEL_TRIGGER_TYPES.includes(input.trigger_type as ModelTriggerType)) {
    return `trigger_type must be one of ${MODEL_TRIGGER_TYPES.map((t) => `"${t}"`).join(' or ')}.`;
  }
  const trigger: Trigger = {
    type: input.trigger_type as ModelTriggerType,
    expression: typeof input.expression === 'string' ? input.expression.trim() : '',
  };
  const invalid = validateTrigger(trigger);
  if (invalid) return `Invalid ${trigger.type} schedule: ${invalid}.`;
  if (
    input.maxExecutions !== undefined &&
    !(Number.isInteger(input.maxExecutions) && (input.maxExecutions as number) > 0)
  ) {
    return 'maxExecutions must be a whole number of at least 1.';
  }
  if (
    input.expiresInHours !== undefined &&
    !(typeof input.expiresInHours === 'number' && Number.isFinite(input.expiresInHours) && input.expiresInHours > 0)
  ) {
    return 'expiresInHours must be a positive number of hours.';
  }
  return null;
}

/** The same for `CronCreate`, whose schedule is always a cron expression. */
export function validateCronToolInput(input: { expression?: unknown; prompt?: unknown }): string | null {
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    return 'The prompt is empty — say what should happen when it fires.';
  }
  const invalid = validateTrigger({
    type: 'cron',
    expression: typeof input.expression === 'string' ? input.expression.trim() : '',
  });
  return invalid ? `Invalid cron schedule: ${invalid}.` : null;
}

/** The tool result the model sees for a refused schedule. */
export function refusedScheduleResult(what: string, reason: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `${what} was NOT saved. ${reason} Accepted schedules — ${TRIGGER_EXPRESSION_HELP} Fix the schedule and call the tool again.`,
      },
    ],
    isError: true,
  };
}
