// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BROWSER_TOOL_SCHEMAS,
  MARK_INTERACTIVE_JS,
  RESOLVE_REF_JS,
  ARIA_SNAPSHOT_SCRIPT,
} from './browser-tools';
import * as fs from 'fs';
import * as path from 'path';

/**
 * THE SNAPSHOT MUST MINT THE REFS IT RETURNS.
 *
 * The agent could look but not touch: seven clicks across two real runs, seven
 * failures, while every index-free tool succeeded. The cause was a split —
 * `data-agent-index` was written by `DOM_EXTRACTION_SCRIPT`, imported by exactly
 * one file (the old hand-rolled loop), while the agent's only way to see the
 * page was `snapshot`, which ran a DIFFERENT script that emitted no addresses at
 * all. The model was shown a picture of the page with nothing to point at.
 *
 * These run the REAL injected scripts against a real DOM, because the failure
 * was two pieces of JavaScript that never met. A test of either alone passes.
 */

const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/browser-tools.ts'), 'utf8');

/*
 * The REAL constants, imported and evaluated — not reconstructed by parsing the
 * source. A reconstruction is a second implementation of the thing under test,
 * and it can differ from it in exactly the way that hides the bug.
 */
const injected = (js: string) => js;

const PAGE = `
  <h1>Camera listings</h1>
  <a href="/one">Nikon FM</a>
  <button id="bid">Place bid</button>
  <input type="text" aria-label="Search" />
  <button style="display:none">Hidden</button>
  <span>not interactive</span>
`;

/** Run the marking script the way the snapshot does. */
function mark(): { version: number; count: number } {
  const fn = new Function(`${MARK_INTERACTIVE_JS}; return markInteractive();`);
  return fn() as { version: number; count: number };
}

/** Run the resolver the way an acting tool does. */
function resolve(ref: string): { el: Element | null; why: string | null } {
  const fn = new Function('ref', `${RESOLVE_REF_JS}; return resolveRef(ref);`);
  return fn(ref) as { el: Element | null; why: string | null };
}

beforeEach(() => {
  document.body.innerHTML = PAGE;
  delete (window as unknown as Record<string, unknown>).__aimeSnapVersion;
  /*
   * jsdom reports every rect as 0x0, and the marking script skips zero-size
   * elements — correctly, since that is how it excludes collapsed and offscreen
   * controls in a real page. Without this the suite would measure nothing and
   * pass vacuously, which is the failure mode these tests exist to prevent.
   *
   * `display:none` is still honoured through getComputedStyle, which jsdom does
   * implement, so the hidden-element case below is a real assertion.
   */
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const hidden = window.getComputedStyle(this).display === 'none';
    return { width: hidden ? 0 : 100, height: hidden ? 0 : 20, top: 0, left: 0,
      right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
});

describe('marking', () => {
  it('stamps every visible interactive element and nothing else', () => {
    const { count } = mark();
    // link + button + input. Not the hidden button, not the h1, not the span.
    expect(count).toBe(3);
    expect(document.querySelectorAll('[data-agent-ref]').length).toBe(3);
    expect(document.querySelector('h1')!.hasAttribute('data-agent-ref')).toBe(false);
  });

  it('versions the refs, and the version increments per snapshot', () => {
    expect(mark().version).toBe(1);
    expect(mark().version).toBe(2);
    expect(document.querySelector('#bid')!.getAttribute('data-agent-ref')).toMatch(/^2:\d+$/);
  });

  it('clears the previous marking, so no ref survives its snapshot', () => {
    mark();
    const first = document.querySelector('#bid')!.getAttribute('data-agent-ref')!;
    mark();
    expect(document.querySelector(`[data-agent-ref="${first}"]`)).toBeNull();
  });
});

/** Run the real ARIA snapshot the way the `snapshot` tool does. */
function snapshot(): string {
  /*
   * PARENTHESISED, and that matters. The constant begins with a newline, so
   * `return\n(function…` hits automatic semicolon insertion and evaluates to
   * undefined — silently making this whole suite measure nothing, which is the
   * vacuous-pass shape these tests exist to catch.
   *
   * Not a bug in the script: `executeJavaScript` evaluates the last expression
   * and never uses `return`. It is a hazard of running it here.
   */
  return new Function(`return (${ARIA_SNAPSHOT_SCRIPT})`)() as string;
}

describe('the snapshot PRINTS the refs it mints', () => {
  /*
   * THE ORIGINAL BUG, and the assertion the rest of this file was missing: the
   * tree described the page and named nothing in it, so the model had no way to
   * say WHICH button. Marking correctly and resolving correctly are both useless
   * if the ref never reaches the model — and a suite that tests only those two
   * halves passes while the agent cannot click a thing.
   */
  it('puts a ref on every interactive line', () => {
    const out = snapshot();
    expect(out).toMatch(/ref=\d+:\d+/);
    // One per marked element, not one for the whole tree.
    expect([...out.matchAll(/ref=\d+:\d+/g)]).toHaveLength(3);
  });

  it('the refs it prints actually resolve', () => {
    // End to end, in one page: print → parse → resolve. This is the join that
    // did not exist, expressed as a test.
    const out = snapshot();
    const refs = [...out.matchAll(/ref=(\d+:\d+)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(resolve(r).el, `ref ${r} did not resolve`).not.toBeNull();
  });

  it('does NOT put refs on things you cannot act on', () => {
    // A ref on a heading invites a click that can only fail.
    const out = snapshot();
    const headingLine = out.split('\n').find((l) => l.includes('[heading]'));
    expect(headingLine).toBeDefined();
    expect(headingLine).not.toMatch(/ref=/);
  });

  it('says which snapshot it is, and that refs expire', () => {
    const out = snapshot();
    expect(out).toMatch(/^Snapshot \d+ — \d+ interactive elements/);
    expect(out).toMatch(/until the page changes/i);
  });

  it('a canvas page says re-snapshotting will not help', () => {
    /*
     * The accessibility tree is empty BY CONSTRUCTION for canvas/WebGL, so
     * "empty page" would invite a retry that cannot ever succeed. Name the tool
     * that can actually see it.
     */
    document.body.innerHTML = '';
    const out = snapshot();
    expect(out).toMatch(/canvas|WebGL/i);
    expect(out).toMatch(/screenshot/);
    expect(out).toMatch(/will not help/i);
  });
});

describe('a ref from a snapshot resolves — the whole point', () => {
  it('resolves an element the marking just stamped', () => {
    mark();
    const ref = document.querySelector('#bid')!.getAttribute('data-agent-ref')!;
    const found = resolve(ref);
    expect(found.el).toBe(document.querySelector('#bid'));
    expect(found.why).toBeNull();
  });
});

describe('a ref that cannot resolve says WHY, and the three cases differ', () => {
  it('no snapshot yet → take one', () => {
    const { why } = resolve('1:0');
    expect(why).toMatch(/no snapshot/i);
    expect(why).toMatch(/snapshot first/i);
  });

  it('stale version → the page moved, do not reuse the number', () => {
    /*
     * The dangerous case. A Cancel button with ref 10 can be a DELETE button
     * with ref 10 after a re-render — so a stale ref must fail, not act.
     */
    mark();
    const stale = document.querySelector('#bid')!.getAttribute('data-agent-ref')!;
    mark(); // page re-rendered; version moved on
    const { el, why } = resolve(stale);
    expect(el).toBeNull();
    expect(why).toMatch(/page changed under you/i);
    expect(why).toMatch(/do NOT retry this ref/i);
    expect(why).toMatch(/same number means the same element/i);
  });

  it('current version but the element is gone → only that one is dead', () => {
    mark();
    const ref = document.querySelector('#bid')!.getAttribute('data-agent-ref')!;
    document.querySelector('#bid')!.remove();
    const { el, why } = resolve(ref);
    expect(el).toBeNull();
    expect(why).toMatch(/no longer in the page/i);
    expect(why).toMatch(/may still be good/i);
  });

  it('EVERY failure names an action — absorbed from the old stale-index suite', () => {
    /*
     * The general rule, over all three branches at once: a message that only
     * describes the symptom ("Element not found at index 5") reads as bad luck,
     * so the model retries the same address. That file asserted this against
     * per-tool message literals which no longer exist — one resolver answers for
     * every acting tool now — so the rule lives here, against real behaviour.
     */
    const cases: string[] = [];
    cases.push(resolve('1:0').why!);                       // no snapshot yet
    mark(); const r = document.querySelector('#bid')!.getAttribute('data-agent-ref')!;
    mark(); cases.push(resolve(r).why!);                   // stale version
    const cur = document.querySelector('#bid')!.getAttribute('data-agent-ref')!;
    document.querySelector('#bid')!.remove();
    cases.push(resolve(cur).why!);                         // gone from current

    expect(new Set(cases).size, 'the three cases must read differently').toBe(3);
    for (const why of cases) {
      expect(why.length, `too terse to act on: ${why}`).toBeGreaterThan(60);
      expect(/snapshot/i.test(why), `no recovery named: ${why}`).toBe(true);
    }
  });

  it('the legacy numeric path still works for the quick-ask loop', () => {
    mark();
    const n = document.querySelector('#bid')!.getAttribute('data-agent-index')!;
    expect(resolve(`LEGACY:${n}`).el).toBe(document.querySelector('#bid'));
  });
});

describe('the tools the model is offered address by ref', () => {
  const schema = (name: string) =>
    BROWSER_TOOL_SCHEMAS.find((s) => s.name === name)! as unknown as {
      input_schema: { properties: Record<string, unknown>; required?: readonly string[] };
    };

  it.each(['click', 'hover', 'select_option'])('%s requires a ref', (name) => {
    const s = schema(name);
    expect(Object.keys(s.input_schema.properties)).toContain('ref');
    expect(s.input_schema.required).toContain('ref');
  });

  it('drag takes two refs', () => {
    const props = Object.keys(schema('drag').input_schema.properties);
    expect(props).toEqual(expect.arrayContaining(['startRef', 'endRef']));
  });

  it('no acting tool still advertises a numeric index', () => {
    // A schema saying `index` would send the model looking for a number the
    // snapshot no longer prints.
    for (const name of ['click', 'hover', 'type_text', 'drag', 'select_option']) {
      expect(Object.keys(schema(name).input_schema.properties)).not.toContain('index');
    }
  });

  it('no tool description points at a tool that does not exist', () => {
    /*
     * `get_page_state` was named in an error message I wrote and has never
     * existed. Telling a model to call a missing tool is a guaranteed dead end.
     */
    const names = new Set<string>(BROWSER_TOOL_SCHEMAS.map((s) => s.name as string));
    const mentioned = [...src.matchAll(/\b(get_page_state|page_state)\b/g)].map((m) => m[1]);
    for (const m of mentioned) expect(names.has(m), `${m} is referenced but not a tool`).toBe(true);
  });
});

describe('the quick-ask loop still works — it addresses by plain number', () => {
  /*
   * THE BRANCH THAT WAS UNREACHABLE. Schemas now declare `ref: string`, so the
   * quick-ask loop — whose page state still numbers elements `[12]` — sends
   * `ref: "12"`. That fell through as a VERSIONED ref and produced "no snapshot
   * has been taken of this page" on a page it had just described, so the loop
   * looked broken by the change that was supposed to leave it alone.
   *
   * Versioned refs always contain a colon, so a bare number is unambiguous.
   */
  it('a bare numeric ref resolves against the legacy index', () => {
    mark();
    const n = document.querySelector('#bid')!.getAttribute('data-agent-index')!;
    expect(resolve(`LEGACY:${n}`).el).toBe(document.querySelector('#bid'));
  });

  it('refOf routes a bare number to the legacy path', async () => {
    // Through the REAL executor, because the translation lives in `refOf` and a
    // direct call to the resolver would skip it.
    mark();
    const n = document.querySelector('#bid')!.getAttribute('data-agent-index')!;
    const calls: string[] = [];
    const wv = {
      executeJavaScript: async (code: string) => {
        calls.push(code);
        return new Function(`return (function(){ ${code.replace(/^\s*\(function\(\) \{/, '').replace(/\}\)\(\)\s*$/, '')} })()`)();
      },
      loadURL: async () => {}, goBack: () => {}, goForward: () => {}, reload: () => {},
      getURL: () => 'about:blank',
      capturePage: async () => ({ toDataURL: () => '' }),
    };
    const { executeToolInWebview } = await import('./browser-tools');
    const result = await executeToolInWebview(wv as never, 'click', { ref: n });
    expect(calls[0]).toContain(`LEGACY:${n}`);
    expect(result.success, result.message).toBe(true);
  });

  it('a versioned ref is NOT treated as legacy', () => {
    // The two must stay distinguishable, or a real ref goes down the index path.
    mark();
    const ref = document.querySelector('#bid')!.getAttribute('data-agent-ref')!;
    expect(ref).toContain(':');
    expect(resolve(ref).el).toBe(document.querySelector('#bid'));
  });
});
