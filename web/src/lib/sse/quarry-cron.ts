'use client';

import { useAssistantStore } from '@/stores/assistant-store';
import { useCronStore } from '@/stores/cron-store';

/**
 * `QUARRY_CRON:<expression>:<prompt>` — the marker the model echoes through a
 * Bash call to schedule a reminder.
 *
 * It has to be looked for in two places, and that is not redundancy: the model
 * either writes the expression into the command directly, or computes it with a
 * script and prints it, so the marker lands in the command on the way in and in
 * the output on the way back. The cowork surface had the same twenty lines twice
 * for exactly that reason — same parse, same dedup, same store write, differing
 * only in the log suffix.
 *
 * The legacy prefix is kept as-is deliberately. It appears in the surface's system
 * prompt and in models' learned behaviour, so renaming it to `AIME_CRON` would
 * silently stop recognising the thing it exists to catch. Worth doing with a
 * transition period that accepts both, not as a drive-by rename.
 */
const MARKER = 'QUARRY_CRON:';

export interface ParsedCron {
  expression: string;
  prompt: string;
}

/**
 * Pull the expression and prompt out of a string containing the marker, or null.
 *
 * Quotes and backslashes are stripped because the marker arrives having been
 * through a shell — the model writes `echo "QUARRY_CRON:0 9 * * *:stand-up"`, so
 * the payload carries whatever quoting survived.
 */
export function parseQuarryCron(text: unknown): ParsedCron | null {
  if (typeof text !== 'string') return null;
  const at = text.indexOf(MARKER);
  if (at === -1) return null;

  const rest = text.slice(at + MARKER.length).replace(/['"\\]/g, '');
  const sep = rest.indexOf(':');
  if (sep === -1) return null;

  const expression = rest.slice(0, sep).trim();
  // First line only: the prompt is followed by whatever else the command printed.
  const prompt = rest.slice(sep + 1).trim().split('\n')[0];
  if (!expression || !prompt) return null;
  return { expression, prompt };
}

/**
 * Schedule a standing order from the marker, if it is present and not already
 * scheduled.
 *
 * The dedup is what makes it safe to call from both the command and the output:
 * a model that writes the expression AND prints it would otherwise create the
 * same order twice.
 *
 * Returns true when an order was created, so a caller can log meaningfully.
 */
export function scheduleFromQuarryCron(text: unknown, surface: string, source: string): boolean {
  const parsed = parseQuarryCron(text);
  if (!parsed) return false;

  const already = useCronStore
    .getState()
    .jobs.some((j) => j.expression === parsed.expression && j.prompt === parsed.prompt);
  if (already) return false;

  const orders = useAssistantStore.getState().orders;
  if (orders.some((o) => o.instruction === parsed.prompt && o.trigger.expression === parsed.expression)) {
    return false;
  }

  useAssistantStore.getState().addOrder({
    instruction: parsed.prompt,
    trigger: { type: 'cron', expression: parsed.expression },
    notifyVia: 'toast',
  });
  console.log(`[${surface}] Cron job scheduled from Bash ${source}:`, parsed.expression, parsed.prompt);
  return true;
}
