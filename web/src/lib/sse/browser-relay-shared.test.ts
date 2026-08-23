import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ONE RELAY, USED BY EVERY SURFACE THAT HAS A WEBVIEW.
 *
 * `browser-tool-chunk.ts` exists because copying forty lines is how two
 * implementations of one idea drift apart. Code kept its inline copy anyway, so
 * the shared module's own comment — "shared with Code rather than copied" — was
 * aspirational, and the drift became real:
 *
 *   the shared path grew tab handling; the inline copy never did, while
 *   `browserMcpToolNames()` mounts new_tab/switch_tab/close_tab for EVERY
 *   surface with a webview. Code therefore offered three tools whose only
 *   possible answer was "Unknown tool" — DR-21's retry loop, reintroduced by
 *   the change meant to end it.
 *
 * Derived from source rather than listed, so a new surface cannot quietly grow
 * a fourth copy.
 */

const SRC = path.join(process.cwd(), 'src');

/** Surface components that handle SSE chunks at all. */
function surfacesHandlingChunks(): Array<{ file: string; code: string }> {
  const dir = path.join(SRC, 'components/surfaces');
  const out: Array<{ file: string; code: string }> = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
        const code = fs.readFileSync(full, 'utf8');
        if (code.includes('onChunk')) out.push({ file: path.relative(SRC, full), code });
      }
    }
  };
  walk(dir);
  return out;
}

describe('the browser relay is not reimplemented', () => {
  it('finds the surfaces, so the checks below are not vacuous', () => {
    expect(surfacesHandlingChunks().length).toBeGreaterThanOrEqual(2);
  });

  it.each(surfacesHandlingChunks().map((s) => s.file))(
    '%s does not inline a browser_tool_use case',
    (file) => {
      const { code } = surfacesHandlingChunks().find((s) => s.file === file)!;
      // Referencing the event type is fine; having a `case` for it is the copy.
      expect(code, 'this surface handles browser_tool_use itself').not.toMatch(
        /case\s+["']browser_tool_use["']/,
      );
    },
  );

  it('every surface that can serve browser tools calls the shared handler', () => {
    /*
     * The complement. Removing the inline case without adding the shared call
     * would leave the tools mounted and unhandled — which is the same "Unknown
     * tool" loop by a different route.
     */
    for (const { file, code } of surfacesHandlingChunks()) {
      if (!code.includes('browserToolsAvailable')) continue; // no webview, no relay
      expect(code, `${file} offers browser tools but does not handle them`).toContain(
        'handleBrowserToolChunk',
      );
    }
  });

  it('a surface with no tabs still answers a tab tool actionably', () => {
    /*
     * `new_tab` is mounted for every surface with a webview, so Code WILL be
     * asked. "Unknown tool" reads as a transient fault and is what produced
     * twenty-two retries in one run; the shared module names the alternative.
     */
    const shared = fs.readFileSync(path.join(SRC, 'lib/sse/browser-tool-chunk.ts'), 'utf8');
    expect(shared).toMatch(/single page, not tabs/i);
    expect(shared).toMatch(/do not try a tab tool again/i);
  });
});
