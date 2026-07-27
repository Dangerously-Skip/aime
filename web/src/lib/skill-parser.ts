/**
 * SKILL.md frontmatter parser and serializer.
 * Handles the simple YAML frontmatter format used by Claude Agent SDK skills.
 *
 * The reader and the writer in this file MUST be exact inverses.
 * `PUT /api/customize/skills/:skillId` is a read-modify-write — parse the file,
 * merge the edited fields, serialize, overwrite — so anything the reader
 * misunderstands isn't a display glitch, it is permanently gone from disk after
 * one save. `skill-parser.test.ts` pins that with a round-trip property test and
 * cross-checks the emitted YAML against js-yaml, which is what actually reads
 * these files at agent-run time; if the two readers disagree, the file means two
 * different things to the app and to the model.
 *
 * Deliberately hand-rolled instead of delegating to js-yaml: this module is
 * imported from client bundles (see `bundled-skills.ts`) and it has to degrade
 * on a malformed file rather than throw. Known limits — all read-only concerns,
 * because the writer never emits any of these forms:
 *   - block scalars (`key: |` / `key: >`) are read as one joined string, and
 *     blank lines and `#` lines inside the block are dropped
 *   - an inline `# comment` after a plain value stays part of the value
 *   - `key:` with nothing after it reads as an empty list (see parseMapping)
 *   - `key: null` / `key: ~` read back as the string, not null, so that a save
 *     preserves the line instead of dropping the key
 *   - hex/octal (`0x1f`) written by hand reads as a string, not a number
 *   - a nested mapping is read to MAX_NESTING levels deep; `requires:` is one
 */

export interface SkillRequires {
  env?: string[];
  bins?: string[];
  platform?: string;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  'allowed-tools'?: string[];
  model?: string;
  context?: string[];
  agent?: string;
  requires?: SkillRequires;
  [key: string]: unknown;
}

export interface SkillGateResult {
  disabled: boolean;
  reason?: string;
}

/**
 * Evaluate a skill's `requires` block against the current environment.
 * Returns { disabled: false } if all requirements are met.
 */
export function evaluateSkillRequires(requires: SkillRequires | undefined): SkillGateResult {
  if (!requires) return { disabled: false };

  if (requires.platform && requires.platform !== process.platform) {
    return { disabled: true, reason: `Requires platform: ${requires.platform} (current: ${process.platform})` };
  }

  if (requires.env) {
    for (const envVar of requires.env) {
      if (!process.env[envVar]) {
        return { disabled: true, reason: `Missing env var: ${envVar}` };
      }
    }
  }

  if (requires.bins) {
    // Synchronously check for binary availability via PATH.
    // Lazy require so this module stays importable from client bundles — a
    // static `import 'child_process'` would pull a node builtin into every
    // consumer of parseSkillMd/serializeSkillMd.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execSync } = require('child_process');
      for (const bin of requires.bins) {
        try {
          execSync(`which ${bin}`, { stdio: 'ignore' });
        } catch {
          return { disabled: true, reason: `Missing binary: ${bin}` };
        }
      }
    } catch {
      // execSync unavailable (browser context) — skip bin check
    }
  }

  return { disabled: false };
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

/** A frontmatter delimiter is a line that is nothing but `---`. */
function isFrontmatterDelimiter(line: string | undefined): boolean {
  return line !== undefined && line.trim() === '---';
}

/**
 * Parse a SKILL.md file content into frontmatter and body.
 */
export function parseSkillMd(content: string): ParsedSkill {
  const trimmed = content.trim();
  const lines = trimmed.split('\n');

  // Both delimiters must be lines of their own. This used to look for the next
  // '---' *anywhere* in the text (`indexOf('---', 3)`), which meant a '---'
  // inside a value ended the block early: `name: Q3 --- Draft` truncated the
  // name to "Q3" and swept description, allowed-tools and everything after it
  // into the body. Quoting the value does not help — the search matched inside
  // the quotes too — so the anchor is what closes it. The file on disk was
  // always valid YAML; only this reader misread it, and one save through the
  // skills PUT route then wrote the misreading back.
  if (!isFrontmatterDelimiter(lines[0])) {
    return { frontmatter: {}, body: trimmed };
  }

  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (isFrontmatterDelimiter(lines[i])) {
      endLine = i;
      break;
    }
  }
  if (endLine === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  return {
    frontmatter: parseSimpleYaml(lines.slice(1, endLine).join('\n')),
    body: lines.slice(endLine + 1).join('\n').trim(),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Characters that mean something structural when they open a plain scalar. */
const INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`~]/;
/**
 * Characters outside YAML's printable set. In a plain scalar even one of these
 * makes js-yaml reject the ENTIRE document ("the stream contains non-printable
 * characters"), so the skill stops being readable by the SDK at all rather than
 * merely reading differently. Escaped inside double quotes they are accepted.
 */
function isNonPrintable(code: number): boolean {
  return (
    code < 0x20 || // C0 controls, including the line breaks and tab
    (code >= 0x7f && code <= 0x9f) || // DEL and the C1 block
    (code >= 0xd800 && code <= 0xdfff) || // a lone surrogate: not valid UTF-8
    code === 0xfffe ||
    code === 0xffff || // noncharacters
    code === 0x2028 ||
    code === 0x2029 // Unicode line separators
  );
}

/** Iterates code points, so a valid astral pair is not read as lone surrogates. */
function hasNonPrintable(value: string): boolean {
  for (const ch of value) {
    if (isNonPrintable(ch.codePointAt(0) as number)) return true;
  }
  return false;
}

/** Plain scalars a YAML reader would resolve to a number rather than a string. */
const NUMBER_LIKE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const RADIX_LIKE = /^[-+]?0[xXoObB][0-9a-fA-F_]+$/;
const SPECIAL_FLOAT_LIKE = /^[-+]?\.(?:inf|nan)$/i;
/** Plain scalars a YAML reader would resolve to a boolean or null. */
const KEYWORD_LIKE = /^(?:true|false|null|yes|no|on|off)$/i;

/**
 * Would this string come back as something other than itself if written plain?
 */
function needsQuoting(value: string): boolean {
  return (
    value === '' ||
    // Leading/trailing whitespace is not preserved by a plain scalar.
    value.trim() !== value ||
    hasNonPrintable(value) ||
    INDICATOR_START.test(value) ||
    // `a: b` and a trailing `a:` are both mapping syntax, not text.
    /:(?:\s|$)/.test(value) ||
    // ` #` opens a comment.
    /\s#/.test(value) ||
    // Not needed now that the terminator is line-anchored, but it keeps the file
    // unambiguous for any reader that anchors less carefully than this one.
    value.includes('---') ||
    // `...` opens a line, it is YAML's document-END marker: js-yaml reads
    // `... a: ""` as the key `a`, and a `... `-prefixed key on any later line
    // makes the whole document a parse error. Only keys begin a line, but the
    // rule is cheap enough to apply to both.
    value.startsWith('...') ||
    KEYWORD_LIKE.test(value) ||
    NUMBER_LIKE.test(value) ||
    RADIX_LIKE.test(value) ||
    SPECIAL_FLOAT_LIKE.test(value)
  );
}

/** YAML double-quoted escapes, keyed by the character after the backslash. */
const ESCAPES_BY_CHAR: Record<string, string> = {
  '0': '\u0000',
  a: '\u0007',
  b: '\b',
  t: '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\u001b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\u0085',
  _: '\u00a0',
  L: '\u2028',
  P: '\u2029',
};

function escapeDoubleQuoted(value: string): string {
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '\\':
        out += '\\\\';
        continue;
      case '"':
        out += '\\"';
        continue;
      case '\n':
        out += '\\n';
        continue;
      case '\r':
        out += '\\r';
        continue;
      case '\t':
        out += '\\t';
        continue;
    }
    const code = ch.codePointAt(0) as number;
    if (isNonPrintable(code)) {
      out += code <= 0xff
        ? `\\x${code.toString(16).padStart(2, '0')}`
        : `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return out;
}

/** The inverse of escapeDoubleQuoted, and lenient about escapes we never emit. */
function unescapeDoubleQuoted(inner: string): string {
  return inner.replace(
    /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[\s\S])/g,
    (_match, escape: string) => {
      const head = escape[0];
      if (escape.length > 1 && (head === 'x' || head === 'u' || head === 'U')) {
        const code = parseInt(escape.slice(1), 16);
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : escape;
      }
      return ESCAPES_BY_CHAR[head] ?? escape;
    },
  );
}

/**
 * Quote a scalar so it cannot break out of its frontmatter field.
 *
 * Values were once written raw, so a skill NAME containing newlines injected
 * arbitrary frontmatter keys — reachable from the model-facing SkillCreate tool,
 * i.e. from prompt injection. A name of "Report\nallowed-tools:\n  - Bash\nmodel:
 * opus" produced a SKILL.md the parser read back with those keys set.
 *
 * Newlines and control characters are ESCAPED, not stripped: `\n` inside a
 * double-quoted scalar is still a single physical line, so the injection stays
 * closed, and unlike collapsing them to spaces it does not quietly rewrite the
 * user's description. Every escape here has an inverse in unescapeDoubleQuoted —
 * without one, each save doubled the backslashes in a quoted value.
 */
function quoteYamlScalar(value: string): string {
  if (!needsQuoting(value)) return value;
  return `"${escapeDoubleQuoted(value)}"`;
}

/**
 * Keys get the same treatment, plus any colon at all: the reader splits a plain
 * line at its first colon, so an unquoted `a:b` key would come back as key `a`.
 */
function quoteYamlKey(key: string): string {
  if (key.includes(':') || needsQuoting(key)) {
    return `"${escapeDoubleQuoted(key)}"`;
  }
  return key;
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return '.nan';
  if (value === Infinity) return '.inf';
  if (value === -Infinity) return '-.inf';
  return String(value);
}

/** Defensive only: frontmatter arrives from JSON, which cannot be cyclic. */
const MAX_NESTING = 6;

function serializeEntry(
  key: string,
  value: unknown,
  indent: string,
  depth: number,
  out: string[],
): void {
  if (value === undefined || value === null) return;
  const name = quoteYamlKey(key);

  if (Array.isArray(value)) {
    // Flow form for an empty list, so it reads back as [] rather than as null
    // (a bare `key:` is ambiguous, and js-yaml resolves it to null).
    if (value.length === 0) {
      out.push(`${indent}${name}: []`);
      return;
    }
    out.push(`${indent}${name}:`);
    for (const item of value) {
      // Items are quoted too: an allowed-tools entry is just as capable of
      // carrying a newline, or a `: `, as a name is.
      // Every list in a SkillFrontmatter is a string[]; an object smuggled into
      // one still stringifies to "[object Object]" rather than nesting.
      out.push(`${indent}  - ${quoteYamlScalar(String(item))}`);
    }
    return;
  }

  if (typeof value === 'boolean') {
    // Bare, so it stays a boolean when parsed back.
    out.push(`${indent}${name}: ${String(value)}`);
    return;
  }

  if (typeof value === 'number') {
    out.push(`${indent}${name}: ${formatNumber(value)}`);
    return;
  }

  if (typeof value === 'object') {
    // Nested blocks (`requires:` with env/bins/platform) used to land here as
    // String(value) === "[object Object]", destroying the block on save.
    // Past MAX_NESTING the key is dropped; the reader stops at the same depth,
    // so the two halves agree on what a document can hold.
    if (depth >= MAX_NESTING) return;
    const children: string[] = [];
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      serializeEntry(childKey, childValue, `${indent}  `, depth + 1, children);
    }
    if (children.length === 0) {
      out.push(`${indent}${name}: {}`);
      return;
    }
    out.push(`${indent}${name}:`);
    out.push(...children);
    return;
  }

  out.push(`${indent}${name}: ${quoteYamlScalar(String(value))}`);
}

/**
 * Serialize frontmatter and body back into SKILL.md format.
 */
export function serializeSkillMd(frontmatter: SkillFrontmatter, body: string): string {
  const yamlLines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    serializeEntry(key, value, '', 0, yamlLines);
  }

  if (yamlLines.length === 0) {
    return body;
  }

  return `---\n${yamlLines.join('\n')}\n---\n\n${body}`;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A sequence item: `- x`, or a bare `-` for an empty one. */
const SEQUENCE_ITEM = /^-(?:\s|$)/;
/** A block scalar header: `|`, `>`, with optional chomp/indent indicators. */
const BLOCK_SCALAR = /^[|>][+-]?\d*$/;

interface YamlLine {
  indent: number;
  text: string;
}

function collectYamlLines(yaml: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const raw of yaml.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    out.push({ indent: line.length - line.trimStart().length, text });
  }
  return out;
}

/** Index of the quote that closes the one at position 0, or -1. */
function findClosingQuote(text: string, quote: string): number {
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (quote === '"' && ch === '\\') {
      i++; // the next character is escaped, including an escaped quote
      continue;
    }
    if (ch === quote) {
      // In a single-quoted scalar, '' is an escaped apostrophe.
      if (quote === "'" && text[i + 1] === "'") {
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/**
 * The inverse of quoteYamlScalar. Returns null when `raw` is not a quoted
 * scalar, which is what keeps a raw value containing a backslash intact: only a
 * value that was actually quoted gets unescaped.
 */
function unquoteScalar(raw: string): string | null {
  const quote = raw[0];
  if (raw.length < 2 || (quote !== '"' && quote !== "'")) return null;
  // Must close at the very end — `"a" # note` is not a quoted scalar to us, and
  // neither is an unterminated `"a\"`.
  if (findClosingQuote(raw, quote) !== raw.length - 1) return null;
  const inner = raw.slice(1, -1);
  return quote === '"' ? unescapeDoubleQuoted(inner) : inner.replace(/''/g, "'");
}

/**
 * Resolve a plain scalar to the type a YAML reader would give it. Anything that
 * was quoted stays a string — that is the whole point of the writer quoting it.
 */
function parseScalarValue(raw: string): unknown {
  const unquoted = unquoteScalar(raw);
  if (unquoted !== null) return unquoted;

  if (raw === '[]') return [];
  if (raw === '{}') return {};
  if (/^(?:true|True|TRUE)$/.test(raw)) return true;
  if (/^(?:false|False|FALSE)$/.test(raw)) return false;
  if (/^[-+]?\d+$/.test(raw)) return parseInt(raw, 10);
  if (NUMBER_LIKE.test(raw)) return parseFloat(raw);
  if (SPECIAL_FLOAT_LIKE.test(raw)) {
    if (/nan/i.test(raw)) return NaN;
    return raw.startsWith('-') ? -Infinity : Infinity;
  }
  return raw;
}

/** Split `key: value`, honouring a quoted key that contains a colon. */
function splitKeyValue(text: string): { key: string; rawValue: string } | null {
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = findClosingQuote(text, quote);
    if (end !== -1) {
      const rest = text.slice(end + 1);
      const colon = rest.indexOf(':');
      if (colon !== -1 && rest.slice(0, colon).trim() === '') {
        const quotedKey = text.slice(0, end + 1);
        return {
          key: unquoteScalar(quotedKey) ?? quotedKey,
          rawValue: rest.slice(colon + 1).trim(),
        };
      }
    }
    // Not a `"key": value` line — fall through and treat it as plain text.
  }

  const colonIndex = text.indexOf(':');
  if (colonIndex === -1) return null;
  return {
    key: text.slice(0, colonIndex).trim(),
    rawValue: text.slice(colonIndex + 1).trim(),
  };
}

function parseSequence(lines: YamlLine[], cursor: { i: number }, indent: number): string[] {
  const items: string[] = [];
  while (cursor.i < lines.length) {
    const line = lines[cursor.i];
    if (line.indent < indent || !SEQUENCE_ITEM.test(line.text)) break;
    const raw = line.text.slice(1).trim();
    // Items are always strings: allowed-tools/context/env are string[].
    items.push(raw === '' ? '' : unquoteScalar(raw) ?? raw);
    cursor.i++;
  }
  return items;
}

/**
 * Read the indented body of a `key: |` / `key: >` block. Not written by
 * serializeSkillMd; supported so a hand-written block does not get read as a
 * pile of bogus top-level keys and then written back that way.
 */
function readBlockScalar(
  lines: YamlLine[],
  cursor: { i: number },
  keyIndent: number,
  fold: boolean,
): string {
  const parts: string[] = [];
  while (cursor.i < lines.length && lines[cursor.i].indent > keyIndent) {
    parts.push(lines[cursor.i].text);
    cursor.i++;
  }
  return parts.join(fold ? ' ' : '\n');
}

/**
 * Set a key as an own property.
 *
 * `result[key] = value` is not safe here: the key comes from a file the model
 * can write, and for `__proto__` a plain assignment sets the object's PROTOTYPE
 * instead of creating a property. A scalar `__proto__: x` was therefore dropped
 * on read (so a save deleted the line), and a nested `__proto__:` block made the
 * parsed frontmatter inherit whatever it contained — e.g. a skill could appear
 * to have `user-invocable: true` without the key being there.
 */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function parseMapping(
  lines: YamlLine[],
  cursor: { i: number },
  indent: number,
  isRoot: boolean,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  while (cursor.i < lines.length) {
    const line = lines[cursor.i];
    if (line.indent < indent) break;

    if (SEQUENCE_ITEM.test(line.text)) {
      // A dash where a key was expected. Nested, it belongs to a sequence an
      // enclosing frame owns; at the root it is malformed, so skip it and keep
      // reading rather than abandoning the rest of the block.
      if (!isRoot) break;
      cursor.i++;
      continue;
    }

    const pair = splitKeyValue(line.text);
    if (!pair) {
      cursor.i++;
      continue;
    }
    cursor.i++;

    if (pair.rawValue !== '') {
      setOwn(
        result,
        pair.key,
        BLOCK_SCALAR.test(pair.rawValue)
          ? readBlockScalar(lines, cursor, line.indent, pair.rawValue.startsWith('>'))
          : parseScalarValue(pair.rawValue),
      );
      continue;
    }

    // Nothing after the colon: a sequence, a nested mapping, or an empty value.
    const next = cursor.i < lines.length ? lines[cursor.i] : null;
    if (next && next.indent >= line.indent && SEQUENCE_ITEM.test(next.text)) {
      setOwn(result, pair.key, parseSequence(lines, cursor, next.indent));
    } else if (next && next.indent > line.indent && depth < MAX_NESTING) {
      setOwn(result, pair.key, parseMapping(lines, cursor, next.indent, false, depth + 1));
    } else {
      // Historical reading of a bare `key:`, and what lets an empty list survive
      // in a legacy file written before `key: []` was emitted.
      setOwn(result, pair.key, []);
    }
  }

  return result;
}

/**
 * Parser for the subset of YAML used in SKILL.md frontmatter: scalars, string
 * sequences, and one nested mapping (`requires:`). The inverse of
 * serializeSkillMd — see the module header before changing either half.
 */
function parseSimpleYaml(yaml: string): SkillFrontmatter {
  const lines = collectYamlLines(yaml);
  return parseMapping(lines, { i: 0 }, 0, true, 0) as SkillFrontmatter;
}
