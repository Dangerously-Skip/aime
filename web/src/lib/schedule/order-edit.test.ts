import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { editableOrderJson, parseOrderEdit, EDITABLE_ORDER_FIELDS } from './order-edit';

const ORDER = {
  id: 'o1',
  instruction: 'Morning briefing',
  trigger: { type: 'cron' as const, expression: '0 9 * * 1-5' },
  notifyVia: 'assistant',
  status: 'active',
  runCount: 12,
  errorCount: 0,
  lastRun: 5,
  state: { seen: 3 },
  createdAt: 1,
  updatedAt: 2,
};

describe('editableOrderJson', () => {
  it('shows only what may be edited — never status, counters or the id', () => {
    const shown = JSON.parse(editableOrderJson(ORDER));
    expect(Object.keys(shown).sort()).toEqual(['instruction', 'notifyVia', 'trigger']);
  });
});

describe('parseOrderEdit', () => {
  it('produces a patch of exactly the editable fields', () => {
    const r = parseOrderEdit(JSON.stringify({ instruction: ' New ', trigger: { type: 'interval', expression: '90 minutes' } }));
    expect(r).toEqual({ ok: true, patch: { instruction: 'New', trigger: { type: 'interval', expression: '90 minutes' } } });
  });

  it('names a JSON syntax error instead of swallowing it', () => {
    const r = parseOrderEdit('{ "instruction": "x", }');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Not valid JSON/);
  });

  it.each(['status', 'runCount', 'lastRun', 'id', 'errorCount', 'state'])('refuses %s', (key) => {
    const r = parseOrderEdit(JSON.stringify({ instruction: 'x', [key]: 'completed' }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(`${key} cannot be edited here`);
  });

  it('validates the trigger with the real parsers', () => {
    const bad = parseOrderEdit(JSON.stringify({ trigger: { type: 'cron', expression: '0 9 * * FUNDAY' } }));
    expect(!bad.ok && bad.error).toMatch(/trigger: .*day of week/);
    const event = parseOrderEdit(JSON.stringify({ trigger: { type: 'event', event: 'build-failed' } }));
    expect(event).toEqual({ ok: true, patch: { trigger: { type: 'event', event: 'build-failed' } } });
  });

  it('checks value types', () => {
    expect(parseOrderEdit('{"instruction": ""}').ok).toBe(false);
    expect(parseOrderEdit('{"notifyVia": "email"}').ok).toBe(false);
    expect(parseOrderEdit('{"maxExecutions": 1.5}').ok).toBe(false);
    expect(parseOrderEdit('{"expiresAt": "tomorrow"}').ok).toBe(false);
    expect(parseOrderEdit('[]').ok).toBe(false);
    expect(parseOrderEdit('{"notifyVia": "inject:cowork", "maxExecutions": null}')).toEqual({
      ok: true,
      patch: { notifyVia: 'inject:cowork', maxExecutions: undefined },
    });
  });

  it('never lets a non-editable key into the patch, whatever is typed (property)', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const r = parseOrderEdit(JSON.stringify(obj));
        return !r.ok || Object.keys(r.patch).every((k) => (EDITABLE_ORDER_FIELDS as readonly string[]).includes(k));
      }),
    );
  });

  it('never throws (property)', () => {
    fc.assert(fc.property(fc.string(), (text) => typeof parseOrderEdit(text).ok === 'boolean'));
  });
});
