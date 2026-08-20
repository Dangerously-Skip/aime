import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  jsonSchemaToZod,
  buildBrowserMcpTools,
  buildIfServable,
  type BrowserBridgeDeps,
} from './browser-tool-bridge';
import { BROWSER_TOOL_SCHEMAS } from '../browser-tools';
import { resolveBrowserToolResult } from '../pending-browser-tools';

/*
 * The missing link, and it was missing in a way nothing could see.
 *
 * `BROWSER_TOOL_SCHEMAS` reached exactly one model — the hand-rolled loop in
 * use-browser-agent.ts. The Agent SDK was never given them, so canUseTool's
 * BROWSER_TOOL_NAMES branch, the SSE event, the relay route and the rendezvous
 * were a delivery system with nothing upstream. Three healthy-looking pieces of
 * a path, and no path.
 */

/** Captures what was registered, standing in for the SDK's `tool()`. */
function fakeSdk() {
  const registered: Array<{
    name: string;
    description: string;
    shape: Record<string, z.ZodTypeAny>;
    handler: (a: Record<string, unknown>) => Promise<unknown>;
  }> = [];
  const emitted: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  let n = 0;
  const deps: BrowserBridgeDeps = {
    tool: (name, description, shape, handler) => {
      registered.push({ name, description, shape, handler });
      return { name };
    },
    emit: async (id, name, input) => {
      emitted.push({ id, name, input });
    },
    newId: () => `tu-${++n}`,
  };
  return { deps, registered, emitted };
}

describe('jsonSchemaToZod', () => {
  it('converts every schema we actually ship', () => {
    // The guard that matters: the converter is narrow on purpose, so it has to
    // be checked against reality rather than against examples.
    for (const s of BROWSER_TOOL_SCHEMAS) {
      expect(() => jsonSchemaToZod(s.input_schema), `${s.name} failed to convert`).not.toThrow();
    }
  });

  it('marks required and optional correctly', () => {
    const shape = jsonSchemaToZod({
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    });
    expect(shape.a.isOptional()).toBe(false);
    expect(shape.b.isOptional()).toBe(true);
  });

  it('keeps descriptions, which is what the model reads', () => {
    const shape = jsonSchemaToZod({
      properties: { url: { type: 'string', description: 'The URL to open' } },
      required: ['url'],
    });
    expect(shape.url.description).toBe('The URL to open');
  });

  it('THROWS on a type it does not understand rather than guessing', () => {
    /*
     * A schema quietly widened to `z.any()` lets the model pass nonsense that
     * fails deep inside a webview. An error at startup names the file and the
     * property; an error at runtime names neither.
     */
    expect(() => jsonSchemaToZod({ properties: { x: { type: 'object' } } })).toThrow(/unsupported/);
    expect(() =>
      jsonSchemaToZod({ properties: { x: { type: 'array', items: { type: 'object' } } } }),
    ).toThrow(/unsupported array item/);
  });
});

describe('the tools the SDK receives', () => {
  it('registers every browser tool except loop control', () => {
    const { deps, registered } = fakeSdk();
    buildBrowserMcpTools(deps);
    const names = registered.map((r) => r.name);
    expect(names).toContain('navigate');
    expect(names).toContain('new_tab');
    expect(names).toContain('screenshot');
    // `done` tells the hand-rolled `for` loop to stop; the SDK ends a turn when
    // the model stops calling tools, so it would mean nothing here.
    expect(names).not.toContain('done');
    expect(names.length).toBe(BROWSER_TOOL_SCHEMAS.length - 1);
  });

  it('carries the same descriptions the model already reads', () => {
    // One source of schemas. Two hand-maintained lists of nineteen tools is the
    // drift the audit test exists to prevent.
    const { deps, registered } = fakeSdk();
    buildBrowserMcpTools(deps);
    const nav = registered.find((r) => r.name === 'navigate')!;
    const src = BROWSER_TOOL_SCHEMAS.find((s) => s.name === 'navigate')!;
    expect(nav.description).toBe(src.description);
  });
});

describe('a tool call round-trips through the client', () => {
  it('emits to the client and returns what the client sent back', async () => {
    /*
     * The whole mechanism in one test: the handler forwards, waits on the
     * rendezvous, and returns the client's output to the model.
     */
    const { deps, registered, emitted } = fakeSdk();
    buildBrowserMcpTools(deps);
    const navigate = registered.find((r) => r.name === 'navigate')!;

    const pending = navigate.handler({ url: 'https://example.test' });
    await vi.waitFor(() => expect(emitted.length).toBe(1));
    expect(emitted[0].name).toBe('navigate');
    expect(emitted[0].input).toEqual({ url: 'https://example.test' });

    resolveBrowserToolResult(emitted[0].id, '## Current Page\nURL: …', false);
    const result = (await pending) as { content: Array<{ text: string }>; isError: boolean };
    expect(result.content[0].text).toContain('## Current Page');
    expect(result.isError).toBe(false);
  });

  it('propagates a client-side failure as a tool error, not a success', async () => {
    const { deps, registered, emitted } = fakeSdk();
    buildBrowserMcpTools(deps);
    const click = registered.find((r) => r.name === 'click')!;

    const pending = click.handler({ index: 4 });
    await vi.waitFor(() => expect(emitted.length).toBe(1));
    resolveBrowserToolResult(emitted[0].id, 'Element not found at index 4', true);
    const result = (await pending) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('gives each call its own id, so two calls cannot cross', async () => {
    // The rendezvous is keyed on it. A shared id is a last-write-wins slot, and
    // this repo has already had two RequestConnector calls cross that way.
    const { deps, registered, emitted } = fakeSdk();
    buildBrowserMcpTools(deps);
    const scroll = registered.find((r) => r.name === 'scroll')!;

    const a = scroll.handler({ direction: 'down' });
    const b = scroll.handler({ direction: 'up' });
    await vi.waitFor(() => expect(emitted.length).toBe(2));
    expect(emitted[0].id).not.toBe(emitted[1].id);

    resolveBrowserToolResult(emitted[0].id, 'A', false);
    resolveBrowserToolResult(emitted[1].id, 'B', false);
    expect(((await a) as { content: Array<{ text: string }> }).content[0].text).toBe('A');
    expect(((await b) as { content: Array<{ text: string }> }).content[0].text).toBe('B');
  });
});

describe('tools exist only where they can be served', () => {
  it('registers nothing without a webview', () => {
    /*
     * A tool the model can call but nothing can execute is the DR-21 failure
     * exactly: asked to "open these in new tabs" with no `new_tab`, the agent
     * could not discover the step was impossible and restated it four times.
     * Absence is expressed by the tool not existing, not by it failing.
     */
    const { deps } = fakeSdk();
    expect(buildIfServable({ ...deps, hasWebview: false })).toEqual([]);
  });

  it('registers them when there is one', () => {
    const { deps } = fakeSdk();
    expect(buildIfServable({ ...deps, hasWebview: true }).length).toBeGreaterThan(15);
  });
});
