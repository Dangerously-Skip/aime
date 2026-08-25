// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parseQuarryCron, scheduleFromQuarryCron } from './quarry-cron';
import { useAssistantStore } from '@/stores/assistant-store';

/**
 * `QUARRY_CRON:<expression>:<prompt>` is how the model schedules a reminder
 * through a Bash call. The parse existed TWICE, verbatim, in cowork-surface —
 * once for the command on the way in, once for the output on the way back,
 * because the model either writes the expression or computes it with a script.
 *
 * Both arrival paths are real, so the duplication was the parse, not the two
 * call sites. The dedup below is what makes calling it twice safe.
 */

beforeEach(() => {
  useAssistantStore.setState({ orders: [], cards: [] } as never);
});

describe('parseQuarryCron', () => {
  it('pulls the expression and prompt out', () => {
    expect(parseQuarryCron('QUARRY_CRON:0 9 * * *:stand-up')).toEqual({
      expression: '0 9 * * *',
      prompt: 'stand-up',
    });
  });

  it('finds the marker mid-string, as it arrives inside a shell command', () => {
    expect(parseQuarryCron('echo "QUARRY_CRON:0 9 * * *:stand-up"')?.expression).toBe('0 9 * * *');
  });

  /** The payload has been through a shell, so quoting survives into it. */
  it('strips quotes and backslashes', () => {
    expect(parseQuarryCron(`QUARRY_CRON:'0 9 * * *':\\"water the plants\\"`)).toEqual({
      expression: '0 9 * * *',
      prompt: 'water the plants',
    });
  });

  it('takes only the first line of the prompt', () => {
    // The command prints more after it; the reminder is the first line.
    expect(parseQuarryCron('QUARRY_CRON:0 9 * * *:stand-up\nnext line\nand more')?.prompt)
      .toBe('stand-up');
  });

  it('returns null when there is nothing to schedule', () => {
    for (const bad of [
      'echo hello',
      'QUARRY_CRON:',              // no separator
      'QUARRY_CRON:0 9 * * *',     // expression but no prompt
      'QUARRY_CRON::prompt',       // no expression
      'QUARRY_CRON:0 9 * * *:',    // no prompt
      undefined, null, 42, {},
    ]) {
      expect(parseQuarryCron(bad as never), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('scheduleFromQuarryCron', () => {
  it('creates a standing order', () => {
    expect(scheduleFromQuarryCron('QUARRY_CRON:0 9 * * *:stand-up', 'Cowork', 'command')).toBe(true);
    expect(useAssistantStore.getState().orders).toEqual([
      expect.objectContaining({
        instruction: 'stand-up',
        trigger: { type: 'cron', expression: '0 9 * * *' },
        notifyVia: 'toast',
      }),
    ]);
  });

  /**
   * The whole reason the dedup exists: a model that writes the marker into the
   * command AND prints it would otherwise schedule the same reminder twice.
   */
  it('does not schedule the same reminder from both the command and the output', () => {
    const text = 'QUARRY_CRON:0 9 * * *:stand-up';
    expect(scheduleFromQuarryCron(text, 'Cowork', 'command')).toBe(true);
    expect(scheduleFromQuarryCron(text, 'Cowork', 'output')).toBe(false);
    expect(useAssistantStore.getState().orders).toHaveLength(1);
  });

  it('does not schedule a duplicate of an order that already exists', () => {
    /*
     * The dedup this protects is unchanged; what it checks AGAINST is not. It
     * used to seed a browser cron store, because the same job could be written
     * to either place. That store is gone (DR-24 step 6) and the write was
     * always order-based, so the check now has one thing to look at — which is
     * the point of the removal.
     */
    scheduleFromQuarryCron('QUARRY_CRON:0 9 * * *:stand-up', 'Cowork', 'command');
    expect(useAssistantStore.getState().orders).toHaveLength(1);

    expect(scheduleFromQuarryCron('QUARRY_CRON:0 9 * * *:stand-up', 'Cowork', 'output')).toBe(false);
    expect(useAssistantStore.getState().orders, 'the same reminder was scheduled twice').toHaveLength(1);
  });

  it('still schedules a genuinely different reminder', () => {
    scheduleFromQuarryCron('QUARRY_CRON:0 9 * * *:stand-up', 'Cowork', 'command');
    expect(scheduleFromQuarryCron('QUARRY_CRON:0 17 * * *:wrap-up', 'Cowork', 'command')).toBe(true);
    expect(useAssistantStore.getState().orders).toHaveLength(2);
  });

  it('does nothing when the marker is absent', () => {
    expect(scheduleFromQuarryCron('npm test', 'Cowork', 'command')).toBe(false);
    expect(useAssistantStore.getState().orders).toHaveLength(0);
  });
});
