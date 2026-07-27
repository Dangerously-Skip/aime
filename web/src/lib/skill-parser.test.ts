import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { load as loadYaml } from 'js-yaml';
import {
  parseSkillMd,
  serializeSkillMd,
  evaluateSkillRequires,
  type SkillFrontmatter,
} from './skill-parser';

describe('parseSkillMd', () => {
  it('parses frontmatter and body', () => {
    const { frontmatter, body } = parseSkillMd(`---
name: deploy
description: Deploys the app
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
---

# Deploy steps
Run the thing.`);

    expect(frontmatter.name).toBe('deploy');
    expect(frontmatter.description).toBe('Deploys the app');
    expect(frontmatter['disable-model-invocation']).toBe(true);
    expect(frontmatter['allowed-tools']).toEqual(['Bash', 'Read']);
    expect(body).toBe('# Deploy steps\nRun the thing.');
  });

  it('returns empty frontmatter when there is none', () => {
    const { frontmatter, body } = parseSkillMd('# Just markdown');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# Just markdown');
  });

  it('treats unterminated frontmatter as body', () => {
    const content = '---\nname: broken\nno closing delimiter';
    const { frontmatter, body } = parseSkillMd(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it('parses booleans, integers and strips quotes', () => {
    const { frontmatter } = parseSkillMd(`---
user-invocable: false
priority: 42
model: "claude-sonnet-5"
hint: 'quoted'
---
body`);
    expect(frontmatter['user-invocable']).toBe(false);
    expect(frontmatter.priority).toBe(42);
    expect(frontmatter.model).toBe('claude-sonnet-5');
    expect(frontmatter.hint).toBe('quoted');
  });

  it('skips comments and blank lines', () => {
    const { frontmatter } = parseSkillMd(`---
# a comment
name: x

description: y
---
body`);
    expect(frontmatter).toEqual({ name: 'x', description: 'y' });
  });

  it('parses a trailing array at the end of the frontmatter', () => {
    const { frontmatter } = parseSkillMd(`---
context:
  - file1.md
  - file2.md
---
body`);
    expect(frontmatter.context).toEqual(['file1.md', 'file2.md']);
  });
});

describe('serializeSkillMd', () => {
  it('round-trips frontmatter and body', () => {
    const original = {
      name: 'deploy',
      description: 'Deploys the app',
      'disable-model-invocation': true,
      'allowed-tools': ['Bash', 'Read'],
    };
    const serialized = serializeSkillMd(original, '# Body');
    const { frontmatter, body } = parseSkillMd(serialized);
    expect(frontmatter).toEqual(original);
    expect(body).toBe('# Body');
  });

  it('omits undefined/null values', () => {
    const serialized = serializeSkillMd({ name: 'x', model: undefined, agent: undefined }, 'body');
    expect(serialized).not.toContain('model');
    expect(serialized).not.toContain('agent');
  });

  it('returns bare body when frontmatter is empty', () => {
    expect(serializeSkillMd({}, 'just body')).toBe('just body');
  });
});

describe('evaluateSkillRequires', () => {
  it('passes when there are no requirements', () => {
    expect(evaluateSkillRequires(undefined)).toEqual({ disabled: false });
    expect(evaluateSkillRequires({})).toEqual({ disabled: false });
  });

  it('disables on platform mismatch', () => {
    const other = process.platform === 'darwin' ? 'win32' : 'darwin';
    const result = evaluateSkillRequires({ platform: other });
    expect(result.disabled).toBe(true);
    expect(result.reason).toContain(other);
  });

  it('passes on matching platform', () => {
    expect(evaluateSkillRequires({ platform: process.platform }).disabled).toBe(false);
  });

  it('disables when a required env var is missing', () => {
    const result = evaluateSkillRequires({ env: ['QUARRY_TEST_DEFINITELY_UNSET_VAR'] });
    expect(result.disabled).toBe(true);
    expect(result.reason).toContain('QUARRY_TEST_DEFINITELY_UNSET_VAR');
  });

  it('passes when required env vars are present', () => {
    process.env.QUARRY_TEST_SET_VAR = '1';
    try {
      expect(evaluateSkillRequires({ env: ['QUARRY_TEST_SET_VAR'] }).disabled).toBe(false);
    } finally {
      delete process.env.QUARRY_TEST_SET_VAR;
    }
  });

  it('disables when a required binary is missing', () => {
    const result = evaluateSkillRequires({ bins: ['definitely-not-a-real-binary-xyz'] });
    expect(result.disabled).toBe(true);
    expect(result.reason).toContain('definitely-not-a-real-binary-xyz');
  });

  it('passes when required binaries exist', () => {
    expect(evaluateSkillRequires({ bins: ['sh'] }).disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip integrity.
//
// The skills PUT route is a read-modify-write: parseSkillMd -> merge ->
// serializeSkillMd -> overwrite the file. So any disagreement between the
// reader and the writer is not a display glitch, it is permanent data loss on
// the next save. These tests are the regressions for two such disagreements.
// ---------------------------------------------------------------------------

/** The frontmatter block of a serialized SKILL.md, for handing to a real YAML parser. */
function yamlBlockOf(md: string): string {
  const lines = md.split('\n');
  expect(lines[0]).toBe('---');
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  expect(end).toBeGreaterThan(0);
  return lines.slice(1, end).join('\n');
}

/** Simulate n saves through the PUT route: parse the file, write it back unchanged. */
function saveCycles(md: string, n: number, onEach: (parsed: ReturnType<typeof parseSkillMd>, cycle: number) => void): void {
  let current = md;
  for (let cycle = 1; cycle <= n; cycle++) {
    const parsed = parseSkillMd(current);
    onEach(parsed, cycle);
    current = serializeSkillMd(parsed.frontmatter, parsed.body);
  }
}

describe('frontmatter terminator is line-anchored (defect 1: --- inside a value)', () => {
  it('keeps every key when a value contains ---', () => {
    const frontmatter: SkillFrontmatter = {
      name: 'Q3 --- Draft',
      description: 'secret desc',
      'user-invocable': true,
    };
    const md = serializeSkillMd(frontmatter, 'BODY');
    const parsed = parseSkillMd(md);

    expect(parsed.frontmatter).toEqual(frontmatter);
    expect(parsed.body).toBe('BODY');
  });

  it('does not end the block at a --- inside a quoted value', () => {
    const frontmatter: SkillFrontmatter = { name: 'Rpt --- model: opus', description: 'kept' };
    const md = serializeSkillMd(frontmatter, 'BODY');
    const parsed = parseSkillMd(md);

    expect(parsed.frontmatter).toEqual(frontmatter);
    expect(parsed.body).toBe('BODY');
  });

  it('does not end the block at a --- that is not on its own line', () => {
    const parsed = parseSkillMd('---\nname: a --- b\ndescription: kept\n---\n\nBODY');
    expect(parsed.frontmatter).toEqual({ name: 'a --- b', description: 'kept' });
    expect(parsed.body).toBe('BODY');
  });

  it('survives a no-op save when the name contains --- (PUT route shape)', () => {
    const md = serializeSkillMd(
      { name: 'Q3 --- Draft', description: 'secret desc', 'user-invocable': true },
      'BODY',
    );
    saveCycles(md, 3, (parsed, cycle) => {
      expect(parsed.frontmatter.description, `cycle ${cycle}`).toBe('secret desc');
      expect(parsed.frontmatter['user-invocable'], `cycle ${cycle}`).toBe(true);
      expect(parsed.body, `cycle ${cycle}`).toBe('BODY');
    });
  });

  it('still treats a --- inside the body as body text', () => {
    const md = serializeSkillMd({ name: 'x' }, 'before\n\n---\n\nafter');
    const parsed = parseSkillMd(md);
    expect(parsed.frontmatter).toEqual({ name: 'x' });
    expect(parsed.body).toBe('before\n\n---\n\nafter');
  });
});

describe('escapes have an inverse (defect 2: unescape on read)', () => {
  it('does not grow backslashes across save cycles', () => {
    const description = 'Use for the "weekly pack": a board report';
    const md = serializeSkillMd({ name: 'pack', description }, 'BODY');

    saveCycles(md, 3, (parsed, cycle) => {
      expect(parsed.frontmatter.description, `cycle ${cycle}`).toBe(description);
    });
  });

  it('keeps array items free of literal quote characters', () => {
    const tools = ['Bash(git commit: -m)', 'Read'];
    const md = serializeSkillMd({ name: 'x', 'allowed-tools': tools }, 'BODY');

    saveCycles(md, 3, (parsed, cycle) => {
      expect(parsed.frontmatter['allowed-tools'], `cycle ${cycle}`).toEqual(tools);
    });
  });

  it('leaves a backslash in an unquoted value untouched', () => {
    const value = 'C:\\Users\\me\\skills';
    const md = serializeSkillMd({ name: 'win', description: value }, 'BODY');

    saveCycles(md, 3, (parsed, cycle) => {
      expect(parsed.frontmatter.description, `cycle ${cycle}`).toBe(value);
    });
    expect(loadYaml(yamlBlockOf(md))).toEqual({ name: 'win', description: value });
  });

  it('round-trips a newline in a value instead of destroying it', () => {
    const description = 'line one\nline two';
    const md = serializeSkillMd({ name: 'x', description }, 'BODY');

    // The escape must not put a real newline in the file — that is the
    // frontmatter-injection hole FIX-6 closed.
    expect(yamlBlockOf(md).split('\n')).toHaveLength(2);
    saveCycles(md, 3, (parsed, cycle) => {
      expect(parsed.frontmatter.description, `cycle ${cycle}`).toBe(description);
    });
  });

  it('still refuses to let a value inject frontmatter keys', () => {
    const md = serializeSkillMd(
      { name: 'Report\nallowed-tools:\n  - Bash\nmodel: opus', description: 'd' },
      'BODY',
    );
    const parsed = parseSkillMd(md);
    expect(parsed.frontmatter['allowed-tools']).toBeUndefined();
    expect(parsed.frontmatter.model).toBeUndefined();
    expect(parsed.frontmatter.name).toBe('Report\nallowed-tools:\n  - Bash\nmodel: opus');
  });

  it('does not let a hostile key inject frontmatter either', () => {
    const md = serializeSkillMd({ 'name\nmodel': 'opus', description: 'd' }, 'BODY');
    const parsed = parseSkillMd(md);
    expect(parsed.frontmatter.model).toBeUndefined();
    expect(parsed.frontmatter['name\nmodel']).toBe('opus');
    expect(parsed.frontmatter.description).toBe('d');
  });

  it('quotes values that would otherwise reparse as a non-string', () => {
    const frontmatter: SkillFrontmatter = {
      name: 'true',
      description: '42',
      model: 'null',
      agent: '1.5',
      'argument-hint': '~',
    };
    const md = serializeSkillMd(frontmatter, 'BODY');
    expect(parseSkillMd(md).frontmatter).toEqual(frontmatter);
    expect(loadYaml(yamlBlockOf(md))).toEqual(frontmatter);
  });

  it('quotes a value that ends in a colon (invalid YAML unquoted)', () => {
    const frontmatter: SkillFrontmatter = { name: 'Note:', description: 'd' };
    const md = serializeSkillMd(frontmatter, 'BODY');
    expect(parseSkillMd(md).frontmatter).toEqual(frontmatter);
    expect(loadYaml(yamlBlockOf(md))).toEqual(frontmatter);
  });

  it('keeps empty collections distinguishable from a missing value', () => {
    const frontmatter: SkillFrontmatter = { name: 'x', 'allowed-tools': [], context: [] };
    const md = serializeSkillMd(frontmatter, 'BODY');
    expect(parseSkillMd(md).frontmatter).toEqual(frontmatter);
    expect(loadYaml(yamlBlockOf(md))).toEqual(frontmatter);
  });

  it('round-trips non-finite numbers the way YAML spells them', () => {
    const md = serializeSkillMd({ a: Infinity, b: -Infinity, c: NaN }, 'BODY');
    const parsed = parseSkillMd(md);
    expect(parsed.frontmatter.a).toBe(Infinity);
    expect(parsed.frontmatter.b).toBe(-Infinity);
    expect(parsed.frontmatter.c).toBeNaN();
  });

  // Also found by the property test: `...` is YAML's document-END marker, so an
  // unquoted key starting with it made the SDK's reader see a different
  // document than ours — or refuse the file outright.
  it('quotes a key that starts with the document-end marker', () => {
    const frontmatter = { '... a': 'kept', name: 'x' };
    const md = serializeSkillMd(frontmatter, 'BODY');

    expect(parseSkillMd(md).frontmatter).toEqual(frontmatter);
    // Unquoted, js-yaml reads the key as `a`; with a second line it throws
    // "end of the stream or a document separator is expected".
    expect(loadYaml(yamlBlockOf(md))).toEqual(frontmatter);
  });

  it('quotes a value that starts with the document-end marker', () => {
    const frontmatter = { name: 'x', description: '... and then' };
    const md = serializeSkillMd(frontmatter, 'BODY');
    expect(parseSkillMd(md).frontmatter).toEqual(frontmatter);
    expect(loadYaml(yamlBlockOf(md))).toEqual(frontmatter);
  });

  // Also found by the property test. Written raw, one of these makes js-yaml
  // throw on the whole document, so the SDK cannot read the skill at all.
  it('escapes characters YAML calls non-printable', () => {
    const frontmatter = {
      name: `noncharacter ${String.fromCodePoint(0xfffe)}`,
      description: `lone surrogate \ud800 and DEL ${String.fromCodePoint(0x7f)} inside`,
      'argument-hint': 'astral \u{1F680} stays as itself',
    };
    const md = serializeSkillMd(frontmatter, 'BODY');

    expect(parseSkillMd(md).frontmatter).toEqual(frontmatter);
    expect(() => loadYaml(yamlBlockOf(md))).not.toThrow();
    expect(loadYaml(yamlBlockOf(md))).toEqual(frontmatter);
    // The emoji is printable, so it is not mangled into escapes.
    expect(md).toContain('\u{1F680}');
  });
});

// Found by the property test below, not by hand: a key the reader assigned with
// `result[key] = value`, which for __proto__ mutates the prototype instead of
// creating a property.
describe('__proto__ is data, not a prototype', () => {
  it('keeps a __proto__ key instead of silently dropping it', () => {
    const md = serializeSkillMd({ name: 'x', ['__proto__']: 'V' }, 'BODY');
    const { frontmatter } = parseSkillMd(md);

    expect(Object.keys(frontmatter).sort()).toEqual(['__proto__', 'name']);
    expect(Object.getOwnPropertyDescriptor(frontmatter, '__proto__')?.value).toBe('V');
    expect(Object.getPrototypeOf(frontmatter)).toBe(Object.prototype);
  });

  it('does not let a __proto__ block forge inherited frontmatter', () => {
    const { frontmatter } = parseSkillMd(`---
name: x
"__proto__":
  user-invocable: true
---
body`);

    expect(Object.getPrototypeOf(frontmatter)).toBe(Object.prototype);
    // Nothing may leak in through the prototype chain.
    expect(frontmatter['user-invocable']).toBeUndefined();
    expect(({} as Record<string, unknown>)['user-invocable']).toBeUndefined();
    expect(Object.keys(frontmatter).sort()).toEqual(['__proto__', 'name']);
  });
});

describe('nested requires block', () => {
  it('parses a hand-written nested requires block', () => {
    const { frontmatter } = parseSkillMd(`---
name: gated
requires:
  env:
    - OPENAI_KEY
  bins:
    - ffmpeg
  platform: darwin
---
body`);

    expect(frontmatter.requires).toEqual({
      env: ['OPENAI_KEY'],
      bins: ['ffmpeg'],
      platform: 'darwin',
    });
    expect(frontmatter.env).toBeUndefined();
    expect(frontmatter.platform).toBeUndefined();
  });

  it('parses sequence items indented at the same level as their key', () => {
    const { frontmatter } = parseSkillMd(`---
requires:
  env:
  - A
  - B
  platform: linux
---
body`);
    expect(frontmatter.requires).toEqual({ env: ['A', 'B'], platform: 'linux' });
  });

  it('survives a save cycle without flattening or stringifying the block', () => {
    const md = `---
name: gated
requires:
  env:
    - OPENAI_KEY
  platform: darwin
---

body`;
    saveCycles(md, 3, (parsed, cycle) => {
      expect(parsed.frontmatter.requires, `cycle ${cycle}`).toEqual({
        env: ['OPENAI_KEY'],
        platform: 'darwin',
      });
    });
    expect(serializeSkillMd(parseSkillMd(md).frontmatter, 'body')).not.toContain('[object Object]');
  });

  it('feeds evaluateSkillRequires a real object after a round-trip', () => {
    const md = serializeSkillMd(
      { name: 'gated', requires: { env: ['SKILL_PARSER_DEFINITELY_UNSET'] } },
      'body',
    );
    const requires = parseSkillMd(md).frontmatter.requires;
    const gate = evaluateSkillRequires(requires);
    expect(gate.disabled).toBe(true);
    expect(gate.reason).toContain('SKILL_PARSER_DEFINITELY_UNSET');
  });

  it('agrees with a real YAML parser on a serialized nested block', () => {
    const frontmatter: SkillFrontmatter = {
      name: 'gated',
      requires: { env: ['A', 'B'], bins: ['jq'], platform: 'darwin' },
    };
    const md = serializeSkillMd(frontmatter, 'body');
    expect(loadYaml(yamlBlockOf(md))).toEqual(frontmatter);
    expect(parseSkillMd(md).frontmatter).toEqual(frontmatter);
  });
});

// ---------------------------------------------------------------------------
// The invariant that should have existed: the writer and the reader are
// inverses. Both defects above are single points in this space; the property
// covers the rest, and cross-checks every generated document against js-yaml
// so AIME's reader and the Agent SDK's reader are proven to agree.
// ---------------------------------------------------------------------------

const NASTY = [
  '',
  ' ',
  'a ',
  ' a',
  'a\nb',
  'a\r\nb',
  'a\tb',
  '"',
  "'",
  '\\',
  'a\\b',
  'a\\\\b',
  '\\"',
  'a"b"c',
  "it's",
  ':',
  'a: b',
  'a:b',
  'Note:',
  'a #b',
  '#a',
  '---',
  'a --- b',
  '...',
  '... a',
  '.. a',
  '--- ',
  '-',
  '- a',
  '?',
  ',',
  '[',
  ']',
  '{',
  '}',
  '&',
  '*',
  '!',
  '|',
  '>',
  '%',
  '@',
  '`',
  '~',
  '=',
  'true',
  'True',
  'false',
  'null',
  '0',
  '007',
  '-5',
  '+5',
  '1.5',
  '.5',
  '1e5',
  '.inf',
  '.nan',
  '0x1F',
  'yes',
  'no',
  'on',
  '12:30',
  '[]',
  '{}',
  'C:\\Users\\me',
  'Use for the "weekly pack": a board report',
  'Bash(git commit: -m)',
  'Deploys the app',
  'emoji \u{1F680}',
  'ünïcødé',
  // Characters YAML calls non-printable: written raw, any one of them makes
  // js-yaml throw on the whole document instead of just reading it differently.
  '\u0007bell',
  '\u001bescape',
  '\u007f del',
  '\u0085 nel',
  '\ufffe',
  'a\uffffb',
  '\ud800 lone surrogate',
  '\u2028',
  '\u00a0nbsp',
  '\ufeff bom',
];

const NASTY_CHARS = ['a', 'Z', '0', '"', "'", '\\', ':', ' ', '#', '-', '\n', '\t', '|', '>', '~', '{', '}', '[', ']', ',', '.', '`', '\u0007', '\u007f', '\ufffe', '\ud800'];

/** Strings built to hit YAML's sharp edges, plus fuzz from the same alphabet. */
const scalarArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...NASTY) },
  {
    weight: 3,
    arbitrary: fc
      .array(fc.constantFrom(...NASTY_CHARS), { maxLength: 14 })
      .map(chars => chars.join('')),
  },
  { weight: 1, arbitrary: fc.string() },
  // Raw bytes and full unicode: this branch is what found the non-printable
  // and document-end-marker defects.
  { weight: 2, arbitrary: fc.string({ unit: 'binary', maxLength: 8 }) },
);

const optional = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });

const frontmatterArb: fc.Arbitrary<SkillFrontmatter> = fc.record({
  name: scalarArb,
  description: scalarArb,
  'argument-hint': optional(scalarArb),
  model: optional(scalarArb),
  agent: optional(scalarArb),
  'user-invocable': fc.boolean(),
  'disable-model-invocation': optional(fc.boolean()),
  priority: optional(fc.integer({ min: -10_000, max: 10_000 })),
  'allowed-tools': optional(fc.array(scalarArb, { maxLength: 4 })),
  context: optional(fc.array(scalarArb, { maxLength: 3 })),
  requires: optional(
    fc.record(
      {
        env: fc.array(scalarArb, { maxLength: 2 }),
        bins: fc.array(scalarArb, { maxLength: 2 }),
        platform: scalarArb,
      },
      { requiredKeys: [] },
    ),
  ),
});

/** toEqual already ignores undefined members; this keeps the js-yaml comparison honest. */
function stripUndefined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? stripUndefined(v as object) : v;
  }
  return out as T;
}

describe('property: parseSkillMd is the inverse of serializeSkillMd', () => {
  it('round-trips arbitrary frontmatter values byte-for-byte', () => {
    fc.assert(
      fc.property(frontmatterArb, fc.string(), (frontmatter, rawBody) => {
        // The body is trimmed on read by design (the writer inserts a blank
        // line after the delimiter), so compare against the trimmed input.
        const body = rawBody.trim();
        const md = serializeSkillMd(frontmatter, body);
        const parsed = parseSkillMd(md);

        expect(parsed.frontmatter).toEqual(stripUndefined(frontmatter));
        expect(parsed.body).toBe(body);
      }),
      { numRuns: 1500 },
    );
  });

  it('survives repeated save cycles without drift', () => {
    fc.assert(
      fc.property(frontmatterArb, (frontmatter) => {
        const first = serializeSkillMd(frontmatter, 'BODY');
        const second = serializeSkillMd(parseSkillMd(first).frontmatter, parseSkillMd(first).body);
        const third = serializeSkillMd(parseSkillMd(second).frontmatter, parseSkillMd(second).body);
        // Idempotent from the first write on: no growth, no decay.
        expect(second).toBe(first);
        expect(third).toBe(first);
      }),
      { numRuns: 1000 },
    );
  });

  it('emits YAML a real parser reads identically', () => {
    fc.assert(
      fc.property(frontmatterArb, (frontmatter) => {
        const md = serializeSkillMd(frontmatter, 'BODY');
        const block = yamlBlockOf(md);
        // js-yaml is what the Agent SDK-side tooling uses; if it disagrees with
        // parseSimpleYaml the file means two different things.
        expect(loadYaml(block)).toEqual(stripUndefined(frontmatter));
      }),
      { numRuns: 1000 },
    );
  });

  it('round-trips hostile keys as well as hostile values', () => {
    const keyArb = fc.oneof(
      fc.constantFrom('name', 'description', '__proto__', 'constructor', 'prototype', '... a', '...', 'a: b', 'a\nb', '#k', 'k#', '', ' ', '-', 'a"b', "a'b", 'a\\b', ':', '---'),
      fc.array(fc.constantFrom(...NASTY_CHARS), { minLength: 1, maxLength: 8 }).map(c => c.join('')),
    );
    fc.assert(
      fc.property(fc.dictionary(keyArb, scalarArb, { maxKeys: 5 }), (frontmatter) => {
        const md = serializeSkillMd(frontmatter, 'BODY');
        const parsed = parseSkillMd(md);
        expect(parsed.frontmatter).toEqual(frontmatter);
        expect(parsed.body).toBe('BODY');
        if (Object.keys(frontmatter).length > 0) {
          expect(loadYaml(yamlBlockOf(md))).toEqual(frontmatter);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
