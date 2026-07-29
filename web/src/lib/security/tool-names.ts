/**
 * One place that knows a tool has two names.
 *
 * The SDK dispatches an in-process MCP tool as `mcp__<server>__<Tool>`, but the
 * surface configs, the tool profiles and `AGENTS.md` all name some of them bare
 * (`cowork-config.ts` lists `'ExcelWrite'` unprefixed and `'mcp__aime__canvas'`
 * prefixed, in the same array). Every security set built from those configs was
 * therefore compared with `===` against a name the SDK never passes:
 *
 *   - `denied.has('mcp__aime__ExcelWrite')` → false, so a withheld tool ran
 *   - `FILE_WRITE_TOOLS.has('mcp__aime__ExcelWrite')` → false, so the write
 *     scope check was skipped entirely for every MCP writer
 *
 * Both directions have to work, because the config half is inconsistent and the
 * dispatch half is not ours to change. `toolMatches` compares on both forms.
 */

/** `mcp__aime__ExcelWrite` → `ExcelWrite`; anything else unchanged. */
export function baseToolName(name: string): string {
  const m = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(name);
  return m ? m[1] : name;
}

/**
 * Is `name` in `set`, whichever way round the two were spelled?
 *
 * Matches when the set holds the name as given, or holds its bare form. Note it
 * deliberately does NOT match a bare set entry against a *different* server's
 * tool of the same name — `baseToolName` keeps the server out of the comparison,
 * so `mcp__evil__Bash` and `Bash` collapse together. That is the safe direction
 * for a deny set (over-match rather than under-match); do not reuse this for an
 * allow set without thinking about it.
 */
export function toolMatches(name: string, set: ReadonlySet<string>): boolean {
  return set.has(name) || set.has(baseToolName(name));
}
