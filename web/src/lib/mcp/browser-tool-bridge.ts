import { z } from 'zod';
import { BROWSER_TOOL_SCHEMAS } from '../browser-tools';
import { waitForBrowserToolResult, BROWSER_TOOL_TIMEOUT_MS } from '../pending-browser-tools';

/**
 * Browser tools, as tools the Agent SDK can actually call.
 *
 * THE GAP THIS CLOSES. `BROWSER_TOOL_SCHEMAS` was handed to exactly one model —
 * the hand-rolled loop in `use-browser-agent.ts`. The Agent SDK was never given
 * them, so `canUseTool`'s `BROWSER_TOOL_NAMES` branch, the SSE `browser_tool_use`
 * event, the relay route and the rendezvous were a delivery system with nothing
 * upstream of it: the model had never been told those tools existed, so it had
 * never called one.
 *
 * The consequence was that the surface whose entire purpose is agentic browsing
 * ran the weakest agent in the app — no MCP, no connectors, no canvas, no
 * memory, no skills — and no surface could drive a browser with the real agent.
 *
 * WHY MCP. `createSdkMcpServer` is the SDK's mechanism for custom tools; there is
 * no separate "raw schemas" option. The objection that MCP's zod-stripping would
 * break interception does not apply here: that constraint is about
 * `RequestConnector` smuggling an outcome back through `updatedInput`, and a tool
 * that awaits and RETURNS ITS OWN RESULT never needs that pattern.
 *
 * ONE SOURCE OF SCHEMAS. These are derived from `BROWSER_TOOL_SCHEMAS` rather
 * than re-declared in zod. Two hand-maintained lists of the same nineteen tools
 * is the drift `browser-tools.audit.test.ts` exists to prevent, and writing it
 * deliberately while adding a second consumer would be indefensible.
 */

/** The SDK's `tool()` helper, typed loosely to avoid importing SDK internals. */
type ToolFactory = (
  name: string,
  description: string,
  shape: Record<string, z.ZodTypeAny>,
  handler: (args: Record<string, unknown>) => Promise<unknown>,
) => unknown;

export interface BrowserBridgeDeps {
  tool: ToolFactory;
  /** Forward the call to the client, which executes it against the webview. */
  emit: (toolUseId: string, name: string, input: Record<string, unknown>) => Promise<void>;
  /** Fresh id per call; the rendezvous is keyed on it. */
  newId: () => string;
}

/**
 * `done` is loop control for the hand-rolled loop — it tells that `for` loop to
 * stop. The SDK ends a turn when the model stops calling tools, so exposing it
 * would offer a way to end the turn that means nothing and invites confusion.
 */
const EXCLUDED = new Set(['done']);

/**
 * Convert the narrow slice of JSON Schema these tools use into a zod shape.
 *
 * Deliberately narrow: string, number, boolean and arrays of those, plus
 * `required` and `description`. Anything else throws rather than guessing —
 * a schema silently converted to `z.any()` would let the model pass nonsense
 * that fails deep inside a webview, which is a much worse error to read than
 * one at startup.
 */
export function jsonSchemaToZod(schema: {
  properties?: Record<string, unknown>;
  // `readonly`: BROWSER_TOOL_SCHEMAS is declared `as const`, so its `required`
  // arrays are readonly tuples and a mutable `string[]` does not accept them.
  readonly required?: readonly string[];
}): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(schema.required ?? []);

  for (const [key, raw] of Object.entries(schema.properties ?? {})) {
    const prop = raw as { type?: string; description?: string; items?: { type?: string } };
    let base: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        base = z.string();
        break;
      case 'number':
      case 'integer':
        base = z.number();
        break;
      case 'boolean':
        base = z.boolean();
        break;
      case 'array': {
        const item = prop.items?.type;
        if (item === 'string') base = z.array(z.string());
        else if (item === 'number' || item === 'integer') base = z.array(z.number());
        else throw new Error(`browser-tool-bridge: unsupported array item type "${item}" on "${key}"`);
        break;
      }
      default:
        throw new Error(`browser-tool-bridge: unsupported property type "${prop.type}" on "${key}"`);
    }

    if (prop.description) base = base.describe(prop.description);
    shape[key] = required.has(key) ? base : base.optional();
  }

  return shape;
}

/**
 * Build the SDK tools.
 *
 * Returns an EMPTY array when no webview can serve them — see `buildIfServable`.
 */
export function buildBrowserMcpTools(deps: BrowserBridgeDeps): unknown[] {
  return BROWSER_TOOL_SCHEMAS.filter((s) => !EXCLUDED.has(s.name)).map((schema) =>
    deps.tool(
      schema.name,
      schema.description,
      jsonSchemaToZod(schema.input_schema),
      async (args) => {
        const id = deps.newId();
        /*
         * Logged at every stage, because this path crosses a process boundary
         * and a request boundary, and when it fails it fails SILENTLY — the
         * model just gets an error and reports "a configuration issue", which
         * names nothing. Three lines here turn that into a diagnosis.
         */
        console.log('[browser-bridge] call', schema.name, id);
        try {
          await deps.emit(id, schema.name, args);
        } catch (err) {
          // `emit` writes the SSE event. If THAT throws, the client is never
          // asked, so waiting on the rendezvous would burn the full timeout for
          // a result that can never arrive.
          console.error('[browser-bridge] emit FAILED for', schema.name, err);
          return {
            content: [{ type: 'text' as const, text: `Could not reach the browser: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
        try {
          const result = await waitForBrowserToolResult(id);
          console.log('[browser-bridge] result', schema.name, id, 'isError:', result.isError, 'len:', result.output.length);
          return {
            content: [{ type: 'text' as const, text: result.output }],
            isError: result.isError,
          };
        } catch (err) {
          console.error('[browser-bridge] no result for', schema.name, id, err instanceof Error ? err.message : err);
          /*
           * The rendezvous timed out: the renderer went away, the tab closed, or
           * the page hung. Reported as a tool error rather than thrown, so the
           * model can choose another approach — a thrown error ends the turn and
           * loses everything the run had already produced.
           */
          return {
            content: [
              {
                type: 'text' as const,
                text: `No response from the browser after ${Math.round(
                  BROWSER_TOOL_TIMEOUT_MS / 1000,
                )}s. The page may have navigated away or the tab may have closed. Re-observe before assuming this worked.`,
              },
            ],
            isError: true,
          };
        }
      },
    ),
  );
}

/**
 * Build the tools only when something can execute them.
 *
 * A tool the model can call but nothing can run is the exact failure DR-21
 * documents: the agent asked to "open these in new tabs" had no `new_tab`, could
 * not discover that the step was impossible, and restated the same intent four
 * times until it ran out of iterations. Registering browser tools on a surface
 * with no webview would reintroduce that one layer down, so absence is expressed
 * by the tool not existing rather than by it failing.
 */
export function buildIfServable(
  deps: BrowserBridgeDeps & { hasWebview: boolean },
): unknown[] {
  return deps.hasWebview ? buildBrowserMcpTools(deps) : [];
}
