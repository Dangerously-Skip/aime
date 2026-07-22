import { describe, it, expect } from 'vitest';
import { parseOrdersFromJson } from './standing-order-yaml';

describe('parseOrdersFromJson', () => {
  it('parses a valid export payload', () => {
    const orders = parseOrdersFromJson(
      JSON.stringify([
        {
          instruction: 'Summarize inbox every morning',
          agentName: 'assistant',
          trigger: { type: 'cron', expression: '0 9 * * *' },
          condition: 'weekday',
          notifyVia: 'slack',
          maxExecutions: 10,
        },
      ]),
    );

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      instruction: 'Summarize inbox every morning',
      agentName: 'assistant',
      trigger: { type: 'cron', expression: '0 9 * * *' },
      condition: 'weekday',
      notifyVia: 'slack',
      maxExecutions: 10,
    });
  });

  it('applies defaults for missing trigger and notifyVia', () => {
    const [order] = parseOrdersFromJson(JSON.stringify([{ instruction: 'do a thing' }]));
    expect(order.trigger).toEqual({ type: 'interval', expression: '1h' });
    expect(order.notifyVia).toBe('assistant');
  });

  it('coerces a missing instruction to an empty string', () => {
    const [order] = parseOrdersFromJson(JSON.stringify([{}]));
    expect(order.instruction).toBe('');
  });

  it('throws for a non-array payload', () => {
    expect(() => parseOrdersFromJson('{"instruction":"x"}')).toThrow('Expected an array');
  });

  it('throws for invalid JSON', () => {
    expect(() => parseOrdersFromJson('not json')).toThrow();
  });
});
