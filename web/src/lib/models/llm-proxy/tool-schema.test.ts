import { describe, it, expect } from 'vitest';
import { sanitizeToolSchema, anthropicToOpenAI } from './translate';

/**
 * Tool schemas crossing the shim must survive a strict validator.
 *
 * A real send through OpenRouter to Gemini failed with, verbatim:
 *
 *   API Error: 502 Upstream error 400: ... "Provider returned error" ...
 *   * GenerateContentRequest.tools[0].function_declarations[34]
 *       .parameters.properties[edits].items.required[0]: property is not defined
 *   * ... function_declarations[36].parameters.properties[sheets].items.pr...
 *
 * An object listed a name in `required` that its own `properties` did not
 * define. Anthropic tolerates it; Gemini rejects the ENTIRE request, so one
 * sloppy tool schema disabled every model behind the shim. Declaration 34 was
 * MultiEdit's `edits`; 36 an Excel tool's `sheets`.
 *
 * Note the 502/"try again in a moment / check status.claude.com" wrapper was
 * pure noise — nothing was transient and nothing was wrong with Anthropic.
 */

/** The offending shape, nested exactly as reported: properties → items → required. */
const multiEditish = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    file_path: { type: 'string' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: { old_string: { type: 'string' } },
        // `new_string` is required but never defined — the reported violation.
        required: ['old_string', 'new_string'],
      },
    },
  },
  required: ['file_path', 'edits'],
};

describe('sanitizeToolSchema', () => {
  it('prunes a required name the object does not define, at any depth', () => {
    const out = sanitizeToolSchema(multiEditish);
    const items = (out.properties as Record<string, { items: Record<string, unknown> }>).edits.items;
    expect(items.required).toEqual(['old_string']);
    // The valid outer `required` is untouched.
    expect(out.required).toEqual(['file_path', 'edits']);
  });

  it('drops `required` entirely when nothing is defined', () => {
    const out = sanitizeToolSchema({ type: 'object', required: ['a', 'b'] });
    expect('required' in out).toBe(false);
  });

  it('strips metadata keys but keeps $defs, so a $ref cannot dangle', () => {
    const out = sanitizeToolSchema({
      $schema: 'x',
      $id: 'y',
      $comment: 'z',
      type: 'object',
      $defs: { thing: { type: 'string' } },
      properties: { a: { $ref: '#/$defs/thing' } },
    });
    expect('$schema' in out).toBe(false);
    expect('$id' in out).toBe(false);
    expect('$comment' in out).toBe(false);
    // Removing the target of a live $ref would be worse than leaving both.
    expect(out.$defs).toEqual({ thing: { type: 'string' } });
    expect(out.properties).toEqual({ a: { $ref: '#/$defs/thing' } });
  });

  it('leaves a already-valid schema semantically unchanged', () => {
    const valid = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    };
    expect(sanitizeToolSchema(valid)).toEqual(valid);
  });

  it('recurses through combinators and arrays of schemas', () => {
    const out = sanitizeToolSchema({
      anyOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'missing'] },
        { type: 'object', required: ['nope'] },
      ],
    });
    const [first, second] = out.anyOf as Array<Record<string, unknown>>;
    expect(first.required).toEqual(['a']);
    expect('required' in second).toBe(false);
  });

  it('survives a non-object schema without throwing', () => {
    expect(sanitizeToolSchema(undefined)).toEqual({});
    expect(sanitizeToolSchema('nonsense')).toEqual({});
  });
});

describe('anthropicToOpenAI — tools are sanitised on the way through', () => {
  it('sends a schema the upstream validator will accept', () => {
    const out = anthropicToOpenAI(
      {
        model: 'x',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'MultiEdit', description: 'edit', input_schema: multiEditish }],
      },
      'google/gemini-3.6-flash',
    );
    const params = out.tools![0].function.parameters as Record<string, unknown>;
    const items = (params.properties as Record<string, { items: Record<string, unknown> }>).edits.items;
    expect(items.required).toEqual(['old_string']);
    expect('$schema' in params).toBe(false);
    // The tool itself must still be offered — sanitising is not dropping.
    expect(out.tools![0].function.name).toBe('MultiEdit');
  });
});
