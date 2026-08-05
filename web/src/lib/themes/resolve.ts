/**
 * Which deck theme a run should use.
 *
 * THE chokepoint, same shape as `resolveSendRoute` and `resolveSearchRoute` and
 * for the same reason: three places already resolved search independently in
 * this codebase and disagreed in production. A second resolver for themes would
 * be the same bet placed again.
 *
 * ## Precedence, and why this order
 *
 *   1. an explicit theme in the request  — "use bauhaus" beats everything
 *   2. the PROJECT's theme               — a client's deck should not silently
 *                                          inherit the theme from another one
 *   3. the global default                — what most decks should look like
 *   4. `null`                            — no theme chosen; the skill picks
 *
 * Project over global is the whole point of having both: someone with a project
 * per client wants that project's decks to look like that client's, without
 * having to remember to say so every time. Global is the answer to "what should
 * a deck look like when nobody has said".
 *
 * `null` is a first-class answer rather than a fallback constant. Nobody has
 * chosen, and the skill choosing by brief ("swiss-grid — dense financials") is a
 * better default than a hardcoded favourite that quietly becomes the house
 * style.
 */

export interface ThemeSelection {
  /** Project-scoped override. */
  projectTheme?: string | null;
  /** Global default from Settings. */
  globalTheme?: string | null;
  /** Named directly in this request, e.g. by a slash command or the prompt. */
  requestTheme?: string | null;
}

export interface ResolvedTheme {
  id: string;
  /** Where it came from — shown to the user so a silent default is explicable. */
  source: 'request' | 'project' | 'global';
}

export function resolveDeckTheme(sel: ThemeSelection): ResolvedTheme | null {
  const request = sel.requestTheme?.trim();
  if (request) return { id: request, source: 'request' };

  const project = sel.projectTheme?.trim();
  if (project) return { id: project, source: 'project' };

  const global = sel.globalTheme?.trim();
  if (global) return { id: global, source: 'global' };

  return null;
}

/**
 * The line the model is given about the resolved theme.
 *
 * Says WHERE the theme came from and where to change it, because a default that
 * applies silently and cannot be traced is indistinguishable from the app having
 * an opinion the user cannot override. Mentioned once, on creation — the user
 * asked for a message about it, not a running commentary.
 */
export function themeInstruction(resolved: ResolvedTheme | null): string {
  if (!resolved) return '';

  const origin =
    resolved.source === 'project'
      ? "this project's design"
      : resolved.source === 'global'
        ? 'the default design'
        : 'the design you asked for';

  const changeIt =
    resolved.source === 'request'
      ? ''
      : ' When you deliver it, note in one short sentence which design was used and that it ' +
        'can be changed in Customize → Design. Say it once, not on every reply.';

  return `\n\n## Deck design\nUse the \`${resolved.id}\` theme for any deck you produce — that is ${origin}. Point the deck's \`<link id="theme-link">\` at \`~/.claude/plugins/html-deck/assets/themes/${resolved.id}.css\`.${changeIt}`;
}
