'use client';

import { useAssistantStore } from '@/stores/assistant-store';

/**
 * `AIME_CRON:<expression>:<prompt>` — a marker the model can echo through a Bash
 * call to schedule a reminder. The first-class path is the `CronCreate` tool;
 * this catches the model that reaches for the shell instead.
 *
 * It has to be looked for in two places, and that is not redundancy: the model
 * either writes the expression into the command directly, or computes it with a
 * script and prints it, so the marker lands in the command on the way in and in
 * the output on the way back. The cowork surface had the same twenty lines twice
 * for exactly that reason — same parse, same dedup, same store write, differing
 * only in the log suffix.
 *
 * `QUARRY_CRON:` is the pre-rename spelling and stays accepted: it sits in old
 * transcripts that a resumed session carries forward, and in whatever models
 * picked up from them. Dropping it would silently stop recognising the thing
 * this exists to catch. New text should only ever say `AIME_CRON:`.
 *
 * (The file keeps its old name because its importer lives in cowork-surface;
 * rename it together with that import.)
 */
export const CRON_MARKER = 'AIME_CRON:';
const LEGACY_CRON_MARKER = 'QUARRY_CRON:';

/** The earliest marker in the text, in either spelling, or null. */
function findMarker(text: string): { at: number; length: number } | null {
  let found: { at: number; length: number } | null = null;
  for (const marker of [CRON_MARKER, LEGACY_CRON_MARKER]) {
    const at = text.indexOf(marker);
    if (at !== -1 && (!found || at < found.at)) found = { at, length: marker.length };
  }
  return found;
}

export interface ParsedCron {
  expression: string;
  prompt: string;
}

/**
 * Pull the expression and prompt out of a string containing the marker, or null.
 *
 * Quotes and backslashes are stripped because the marker arrives having been
 * through a shell — the model writes `echo "AIME_CRON:0 9 * * *:stand-up"`, so
 * the payload carries whatever quoting survived.
 */
export function parseCronMarker(text: unknown): ParsedCron | null {
  if (typeof text !== 'string') return null;
  const marker = findMarker(text);
  if (!marker) return null;

  const rest = text.slice(marker.at + marker.length).replace(/['"\\]/g, '');
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
export function scheduleFromCronMarker(text: unknown, surface: string, source: string): boolean {
  const parsed = parseCronMarker(text);
  if (!parsed) return false;

  /*
   * ONE dedup check now, against orders. There were two — this also consulted a
   * browser cron store, back when the same job could be written to either. That
   * store is gone (DR-24 step 6) and the write below was always order-based, so
   * the second check had nothing left to find.
   */
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
