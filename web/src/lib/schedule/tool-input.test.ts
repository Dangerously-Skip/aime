import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MODEL_TRIGGER_TYPES,
  refusedScheduleResult,
  validateCronToolInput,
  validateStandingOrderInput,
} from './tool-input';
import { validateTrigger } from './schedule';

const order = (over: Record<string, unknown> = {}) => ({
  instruction: 'Check the build',
  trigger_type: 'cron',
  expression: '0 9 * * 1-5',
  ...over,
});

describe('validateStandingOrderInput', () => {
  it('accepts what the tickers run', () => {
    expect(validateStandingOrderInput(order())).toBeNull();
    expect(validateStandingOrderInput(order({ trigger_type: 'interval', expression: '90m' }))).toBeNull();
    expect(validateStandingOrderInput(order({ trigger_type: 'interval', expression: '2h', maxExecutions: 3, expiresInHours: 0.5 }))).toBeNull();
  });

  it('refuses a cron the parser cannot read, with its reason', () => {
    const err = validateStandingOrderInput(order({ expression: '0 9 * *' }));
    expect(err).toMatch(/^Invalid cron schedule: /);
    expect(err).toContain(validateTrigger({ type: 'cron', expression: '0 9 * *' })!);
  });

  it('refuses an interval written as prose', () => {
    expect(validateStandingOrderInput(order({ trigger_type: 'interval', expression: 'every two hours' }))).toMatch(
      /^Invalid interval schedule/,
    );
  });

  it('refuses a cron expression passed as an interval and vice versa', () => {
    expect(validateStandingOrderInput(order({ trigger_type: 'interval', expression: '0 9 * * *' }))).not.toBeNull();
    expect(validateStandingOrderInput(order({ trigger_type: 'cron', expression: '5m' }))).not.toBeNull();
  });

  it('does not offer event triggers — nothing fires them', () => {
    expect(MODEL_TRIGGER_TYPES).toEqual(['cron', 'interval']);
    expect(validateStandingOrderInput(order({ trigger_type: 'event', expression: 'build-failed' }))).toMatch(/trigger_type/);
  });

  it('refuses an empty instruction and nonsense limits', () => {
    expect(validateStandingOrderInput(order({ instruction: '  ' }))).toMatch(/instruction/);
    expect(validateStandingOrderInput(order({ maxExecutions: 0 }))).toMatch(/maxExecutions/);
    expect(validateStandingOrderInput(order({ maxExecutions: 1.5 }))).toMatch(/maxExecutions/);
    expect(validateStandingOrderInput(order({ expiresInHours: -1 }))).toMatch(/expiresInHours/);
  });

  it('agrees with validateTrigger for any expression (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom('cron', 'interval'), fc.string({ maxLength: 30 }), (type, expression) => {
        const mine = validateStandingOrderInput(order({ trigger_type: type, expression }));
        const theirs = validateTrigger({ type: type as 'cron' | 'interval', expression: expression.trim() });
        expect(mine === null).toBe(theirs === null);
      }),
      { numRuns: 500 },
    );
  });
});

describe('validateCronToolInput', () => {
  it('accepts a real cron and refuses the rest', () => {
    expect(validateCronToolInput({ expression: '*/10 * * * *', prompt: 'stretch' })).toBeNull();
    expect(validateCronToolInput({ expression: '61 9 * * *', prompt: 'x' })).toMatch(/^Invalid cron schedule/);
    expect(validateCronToolInput({ expression: '0 9 * * *', prompt: '' })).toMatch(/prompt/);
  });
});

describe('refusedScheduleResult', () => {
  it('is a tool error that says it was not saved and how to fix it', () => {
    const r = refusedScheduleResult('The standing order', 'Invalid cron schedule: nope.');
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/NOT saved/);
    expect(r.content[0].text).toContain('Invalid cron schedule: nope.');
    expect(r.content[0].text).toMatch(/interval/);
  });
});
