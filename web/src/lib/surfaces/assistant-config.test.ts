import { describe, it, expect } from 'vitest';
import { getAssistantConfig } from './assistant-config';
import { parseIntervalMs } from '@/lib/schedule/interval';
import { validateCron } from '@/lib/schedule/cron';

const prompt = getAssistantConfig().systemPrompt as string;

describe('the Assistant prompt teaches schedules the tickers can run', () => {
  it('asks for a desktop notification on reminders', () => {
    // 'assistant' (card only) meant "remind me to stretch" never popped up.
    expect(prompt).toMatch(/"remind me in 5 minutes".*notifyVia: "toast"/);
    expect(prompt).toMatch(/Reminders must use "toast"/);
  });

  it('every example expression parses', () => {
    for (const [, kind, expr] of prompt.matchAll(/trigger_type: "(cron|interval)", expression: "([^"]+)"/g)) {
      if (kind === 'interval') expect(parseIntervalMs(expr), expr).not.toBeNull();
      else expect(validateCron(expr), expr).toBeNull();
    }
  });
});
