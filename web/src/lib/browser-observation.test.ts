import { describe, it, expect } from 'vitest';
import { formatPageStateForModel, ELEMENT_BUDGET, type PageState } from './browser-tools';

/*
 * THE BUDGET WAS SPENT ON FURNITURE.
 *
 * A user asked the browser agent to compare camera listings across several
 * pages and pick the best resale value. Elements were collected in DOM order
 * and cut at the first 100 — and on that page the masthead, fourteen category
 * tabs and a sidebar of ~30 filters come first. The agent was reasoning about
 * listings it had never been shown, and the only hint was a bare
 * "... and N more elements".
 *
 * A perfect outer loop over a blind executor still fails, which is why this
 * landed before the harness work.
 */

const el = (
  index: number,
  region: string,
  text: string,
  extra: Partial<PageState['elements'][number]> = {},
): PageState['elements'][number] => ({ index, tag: 'a', text, region, ...extra });

const page = (elements: PageState['elements']): PageState => ({
  url: 'https://example.test/search',
  title: 'Search results',
  text: 'page text',
  elements,
  elementCount: elements.length,
});

/** A listings page: chrome first in DOM order, then the results. */
const listingsPage = (chrome: number, listings: number) =>
  page([
    ...Array.from({ length: chrome }, (_, i) => el(i, i % 2 ? 'nav' : 'header', `chrome ${i}`)),
    ...Array.from({ length: listings }, (_, i) =>
      el(chrome + i, 'main', `Canon EOS ${i}`, { href: `/item/${i}` }),
    ),
  ]);

describe('content outranks chrome when the budget binds', () => {
  it('shows listings even when navigation comes first in DOM order', () => {
    // The reported failure, as a fixture: 80 elements of furniture ahead of the
    // results, and previously a hard cut at 100.
    const out = formatPageStateForModel(listingsPage(80, 200));
    expect(out).toContain('Canon EOS 0');
    expect(out).toContain('Canon EOS 100');
  });

  it('drops chrome before it drops content', () => {
    const out = formatPageStateForModel(listingsPage(300, 100));
    for (let i = 0; i < 100; i++) {
      expect(out, `listing ${i} was dropped in favour of page furniture`).toContain(
        `Canon EOS ${i}`,
      );
    }
  });

  it('keeps DOM order WITHIN a region', () => {
    // Reading order carries meaning — "first result" should be first.
    const out = formatPageStateForModel(listingsPage(5, 4));
    const positions = [0, 1, 2, 3].map((i) => out.indexOf(`Canon EOS ${i}`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('NEVER renumbers the click handle', () => {
    /*
     * `index` is what `click` targets. Reordering the display while renumbering
     * would make the agent click the wrong thing — a far worse bug than the one
     * being fixed, and silent.
     */
    const out = formatPageStateForModel(listingsPage(3, 3));
    expect(out).toContain('[3] a in=main "Canon EOS 0"');
    expect(out).toContain('[5] a in=main "Canon EOS 2"');
  });
});

describe('omissions are legible', () => {
  it('names what was dropped, by region', () => {
    const out = formatPageStateForModel(listingsPage(400, 10));
    expect(out).toMatch(/## Omitted \(\d+\)/);
    expect(out).toMatch(/in (nav|header)/);
  });

  it('says plainly when CONTENT is not fully visible', () => {
    /*
     * "... and 137 more elements" reads as incidental, so a model asked to be
     * exhaustive answers from what it can see and stops — FM2, premature
     * termination on partial answers.
     */
    const out = formatPageStateForModel(listingsPage(10, 500));
    expect(out).toContain('CONTENT elements');
    expect(out).toMatch(/not fully visible/);
    expect(out).toMatch(/Scroll or use pagination/);
  });

  it('says nothing about omissions when nothing was omitted', () => {
    // A quiet page should not grow a warning it does not need.
    const out = formatPageStateForModel(listingsPage(2, 3));
    expect(out).not.toContain('## Omitted');
    expect(out).not.toContain('not fully visible');
  });

  it('reports the true total alongside what is shown', () => {
    const out = formatPageStateForModel(listingsPage(100, 400));
    expect(out).toContain(`500 total, showing ${ELEMENT_BUDGET}`);
  });
});

describe('the budget itself', () => {
  it('is larger than the 100 that caused the failure', () => {
    // A structured row costs a few tokens; we already send 3,000 characters of
    // page text beside it, so 100 was not a considered budget.
    expect(ELEMENT_BUDGET).toBeGreaterThan(100);
  });

  it('elements with no region are treated as content, not chrome', () => {
    // A page with no landmarks at all must not have everything demoted.
    const out = formatPageStateForModel(
      page([
        ...Array.from({ length: 300 }, (_, i) => el(i, 'nav', `nav ${i}`)),
        { index: 300, tag: 'a', text: 'unlabelled listing' },
      ]),
    );
    expect(out).toContain('unlabelled listing');
  });
});
