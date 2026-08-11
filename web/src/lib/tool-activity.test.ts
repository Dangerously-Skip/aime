import { describe, it, expect } from 'vitest';
import { describeToolActivity, describeToolProgress, baseToolLabel } from './tool-activity';

/**
 * During a long research turn the screen said `Running mcp__aime__SearchWeb...`
 * and then, for minutes, a collapsed "7 actions completed". That tells a user
 * neither what is happening nor whether it is stuck, and it leaks an internal
 * naming convention they never chose.
 */
describe('describeToolActivity', () => {
  it.each([
    ['mcp__aime__SearchWeb', { query: 'Parklea house price forecast' }, 'Searching the web for “Parklea house price forecast”'],
    ['mcp__web-search__web_search', { query: 'sydney rates' }, 'Searching the web for “sydney rates”'],
    ['WebSearch', { query: 'sydney rates' }, 'Searching the web for “sydney rates”'],
    ['mcp__aime__FetchUrl', { url: 'https://www.realestate.com.au/news/what-your-h' }, 'Reading realestate.com.au'],
    ['Read', { file_path: '/Users/me/work/pricing.csv' }, 'Reading pricing.csv'],
    ['Write', { file_path: '/Users/me/work/deck.html' }, 'Writing deck.html'],
    ['Edit', { file_path: '/w/a/b/notes.md' }, 'Editing notes.md'],
    ['mcp__aime__CreateImage', { prompt: 'a suburban street' }, 'Generating an image of a suburban street'],
    ['mcp__aime__MailSearch', {}, 'Searching your mail'],
    ['mcp__aime__CalendarEvents', {}, 'Checking your calendar'],
    ['Grep', { pattern: 'TODO' }, 'Searching files for “TODO”'],
    ['spawn_agent', { agentName: 'researcher' }, 'Handing off to the researcher agent'],
  ])('%s → a sentence', (name, input, expected) => {
    expect(describeToolActivity(name, input)).toBe(expected);
  });

  it('never shows the mcp plumbing, even for a tool it does not know', () => {
    const out = describeToolActivity('mcp__aime__SomeBrandNewThing', {});
    expect(out, 'the internal id leaked to the user').not.toMatch(/mcp__|aime__/);
    expect(out).toBe('Some brand new thing');
  });

  it('names the subject rather than the tool', () => {
    // "Read" alone is not information; the filename is the whole point.
    expect(describeToolActivity('Read', { file_path: '/a/b/quarterly-report.pdf' }))
      .toContain('quarterly-report.pdf');
  });

  it('falls back gracefully when the input has nothing useful', () => {
    expect(describeToolActivity('mcp__aime__SearchWeb', {})).toBe('Searching the web');
    expect(describeToolActivity('Read', {})).toBe('Reading a file');
  });

  it('truncates a long subject on a word boundary', () => {
    const query = 'what are house prices expected to do in western sydney over the next five to seven years';
    const out = describeToolActivity('mcp__aime__SearchWeb', { query });

    // The rule is about the SUBJECT, not the whole sentence — asserting a total
    // length would only pin whatever the prefix happens to be today.
    const subject = out.replace(/^Searching the web for “/, '').replace(/”$/, '');
    expect(subject.length).toBeLessThanOrEqual(49);
    expect(subject.endsWith('…')).toBe(true);

    // "Word boundary" means the kept text is a prefix of the original that ends
    // where a word ends — checked against the ORIGINAL, since a cut ending in a
    // letter is exactly what a clean cut looks like.
    const kept = subject.slice(0, -1);
    expect(query.startsWith(kept), 'the kept text is not a prefix of the query').toBe(true);
    expect(query[kept.length], 'cut mid-word').toBe(' ');
  });

  it.each([null, undefined, '', 42, {}])('survives the non-name %p', (bad) => {
    expect(() => describeToolActivity(bad as never, {})).not.toThrow();
    expect(describeToolActivity(bad as never, {})).toBeTruthy();
  });

  it('survives a malformed input without blanking the line', () => {
    expect(describeToolActivity('Read', 'not an object' as never)).toBe('Reading a file');
    expect(describeToolActivity('mcp__aime__FetchUrl', { url: 42 })).toBe('Reading a page');
  });

  it('keeps an unparseable URL rather than dropping it', () => {
    expect(describeToolActivity('mcp__aime__FetchUrl', { url: 'not a url' })).toBe('Reading not a url');
  });
});

describe('baseToolLabel', () => {
  it.each([
    ['mcp__aime__CalendarEvents', 'Calendar events'],
    ['mcp__web-search__web_search', 'Web search'],
    ['mcp__aime__FetchUrl', 'Fetch url'],
    ['NotebookEdit', 'Notebook edit'],
    ['Bash', 'Bash'],
  ])('%s → %s', (name, expected) => {
    expect(baseToolLabel(name)).toBe(expected);
  });
});

/**
 * The headline should answer "what is it doing right now?" — the question the
 * user actually has while watching a spinner — rather than "how many things
 * have happened", which is what the old label counted.
 */
describe('describeToolProgress', () => {
  const call = (name: string, status: string, input: Record<string, unknown> = {}) => ({ name, status, input });

  it('names the running step', () => {
    expect(
      describeToolProgress([call('mcp__aime__SearchWeb', 'running', { query: 'parklea' })]),
    ).toBe('Searching the web for “parklea”');
  });

  it('adds the count only once something has finished', () => {
    const out = describeToolProgress([
      call('Read', 'complete'),
      call('Read', 'complete'),
      call('mcp__aime__FetchUrl', 'running', { url: 'https://example.com/a' }),
    ]);
    expect(out).toBe('Reading example.com · 2 done');
  });

  it('names the last step when everything has finished', () => {
    const out = describeToolProgress([
      call('mcp__aime__SearchWeb', 'complete', { query: 'x' }),
      call('Write', 'complete', { file_path: '/w/deck.html' }),
    ]);
    expect(out, 'a bare count says nothing about the turn').toBe('2 steps · Writing deck.html');
  });

  it('reports failures rather than burying them', () => {
    expect(
      describeToolProgress([call('Read', 'complete'), call('Bash', 'error')]),
    ).toBe('2 steps (1 failed)');
  });

  it.each([
    [[], 'Working'],
    [[call('Read', 'complete', { file_path: '/a/b.md' })], '1 step · Reading b.md'],
  ])('handles %j', (calls, expected) => {
    expect(describeToolProgress(calls)).toBe(expected);
  });
});
