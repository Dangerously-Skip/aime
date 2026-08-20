import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  executeToolInWebview,
  BROWSER_TOOL_SCHEMAS,
  toolResultContent,
  type WebviewRef,
} from './browser-tools';

/*
 * Vision, added deliberately last and deliberately discouraged.
 *
 * The agent reads pages through a structured element list and the accessibility
 * tree, which is where the field has settled: an a11y snapshot is a few hundred
 * tokens where a screenshot is thousands, and screenshots are read less reliably
 * on dense layouts. Best practice is a11y-primary with vision used SELECTIVELY.
 *
 * But there are questions text cannot answer — a canvas, an image-only chart, a
 * layout that renders nothing accessible, "is this button actually visible" —
 * and `capturePage` was already sitting on the WebviewRef interface with no tool
 * able to reach it.
 */

const stubWebview = (over: Partial<WebviewRef> = {}): WebviewRef =>
  ({
    getURL: () => 'https://example.test/chart',
    capturePage: async () => ({ toDataURL: () => 'data:image/png;base64,AAAABBBB' }),
    executeJavaScript: async () => null,
    loadURL: async () => {},
    goBack: () => {},
    goForward: () => {},
    reload: () => {},
    ...over,
  }) as unknown as WebviewRef;

describe('the screenshot tool', () => {
  it('returns the base64 payload WITHOUT the data-url prefix', async () => {
    // The API wants the payload alone; sending `data:image/png;base64,…` fails
    // the request rather than the tool, which reads to the model as a broken page.
    const r = await executeToolInWebview(stubWebview(), 'screenshot', {});
    expect(r.success).toBe(true);
    expect(r.image?.data).toBe('AAAABBBB');
    expect(r.image?.data).not.toContain('base64,');
    expect(r.image?.mediaType).toBe('image/png');
  });

  it('names the page it captured', async () => {
    const r = await executeToolInWebview(stubWebview(), 'screenshot', {});
    expect(r.message).toContain('https://example.test/chart');
  });

  it('refuses an oversized capture rather than failing the request', async () => {
    /*
     * A retina full-page capture can be very large. Too big is a tool failure
     * the model can act on; too big sent upstream is a request error it cannot.
     */
    const huge = 'A'.repeat(9_000_000);
    const r = await executeToolInWebview(
      stubWebview({ capturePage: async () => ({ toDataURL: () => `data:image/png;base64,${huge}` }) }),
      'screenshot',
      {},
    );
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/too large/i);
    expect(r.image).toBeUndefined();
  });

  it('an empty capture is a failure, not an empty image', async () => {
    const r = await executeToolInWebview(
      stubWebview({ capturePage: async () => ({ toDataURL: () => 'data:image/png;base64,' }) }),
      'screenshot',
      {},
    );
    expect(r.success).toBe(false);
  });

  it('a throwing capture is reported, not swallowed', async () => {
    const r = await executeToolInWebview(
      stubWebview({
        capturePage: async () => {
          throw new Error('renderer gone');
        },
      }),
      'screenshot',
      {},
    );
    expect(r.success).toBe(false);
    expect(r.message).toContain('renderer gone');
  });
});

describe('vision is steered away from, not toward', () => {
  const schema = BROWSER_TOOL_SCHEMAS.find((t) => t.name === 'screenshot')!;

  it('the description tells the model to prefer text', () => {
    // A model given a camera reaches for it. The cost of a screenshot per step
    // is real, so the discouragement belongs where the model reads it.
    expect(schema).toBeTruthy();
    expect(schema.description).toMatch(/prefer/i);
    expect(schema.description).toMatch(/snapshot|element list/i);
    expect(schema.description).toMatch(/only when/i);
  });

  it('requires a REASON, so it cannot become the default', () => {
    const props = schema.input_schema.properties as Record<string, unknown>;
    expect(props.reason).toBeTruthy();
    expect(schema.input_schema.required).toContain('reason');
  });
});

describe('the image actually reaches the model', () => {
  /*
   * The first version of this scanned the hook's source for `result.image` and
   * `type: 'image'`. Those strings survive a sabotage that drops the image on
   * the floor, so the test passed while the feature was broken — the exact
   * shape this repo keeps getting caught by. Packing is a function now, so the
   * behaviour can be called.
   */
  it('packs a plain result as a STRING, not a one-block array', () => {
    // Every tool call that is not a screenshot goes through here; an array of
    // one text block would be noise on all of them.
    expect(toolResultContent({ success: true, message: 'Clicked [4]' })).toBe('Clicked [4]');
  });

  it('packs an image result as text + image blocks', () => {
    const content = toolResultContent({
      success: true,
      message: 'Screenshot of https://x',
      image: { mediaType: 'image/png', data: 'PAYLOAD' },
    });
    expect(Array.isArray(content)).toBe(true);
    expect(content).toEqual([
      { type: 'text', text: 'Screenshot of https://x' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'PAYLOAD' } },
    ]);
  });

  it('the loop uses the function rather than packing inline', () => {
    // The remaining source check, and it is a narrow one: that the loop calls
    // the thing the tests above prove correct.
    const hook = readFileSync(resolve(__dirname, '../hooks/use-browser-agent.ts'), 'utf8');
    expect(hook).toContain('toolResultContent(result)');
  });
});
