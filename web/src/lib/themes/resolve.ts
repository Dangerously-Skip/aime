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

  return `\n\n## Deck design

A theme is set, so build the deck as an **HTML deck** using the \`deck-html\` skill. Do NOT reach for the pptx workflow unless the user explicitly asks for an editable PowerPoint file — a theme cannot be applied to one, and producing a pptx here silently discards the design the user chose.

Use the \`${resolved.id}\` theme — that is ${origin}. Point the deck's \`<link id="theme-link">\` at \`~/.claude/plugins/html-deck/assets/themes/${resolved.id}.css\`, and lift slide markup from \`~/.claude/plugins/html-deck/templates/single-page/\` rather than writing your own; hand-rolled markup does not consume the theme's tokens and stops matching it halfway through.

If the user does insist on pptx, say in one sentence that the \`${resolved.id}\` design cannot be carried into it.

### When they ask for a different look
If the user asks to restyle a deck, or for other design options, do NOT ask them to open Settings and do not ask an open question like "what did you change?". Call \`AskUserQuestion\` with concrete choices: \`${resolved.id}\` (their current setting, labelled as such) plus two or three alternatives from the 36 in \`~/.claude/plugins/html-deck/assets/themes/\`, each with one line saying what it suits. Pick alternatives that differ from the current one in KIND — a serif editorial look, a dark technical one, an expressive one — rather than three neighbours of the same style, and rebuild with whichever they choose.

Applying a theme for one deck this way does not change their default; say so once if they seem to expect it to.

### Images
Decks need pictures. Use the \`image-hero\` and \`image-grid\` layouts where a visual belongs — a cover, a venue, a product, a place.

**Generate them with \`CreateImage\`.** It writes the file next to the deck and returns a relative path to embed; the theme's palette and character are applied automatically, so you do not need to describe the styling — describe the SUBJECT. Do this for the cover and for any slide whose point is visual. It is capped per turn and tells you what you have used.

Never invent an image URL, and never hotlink one you have not verified: a broken \`<img>\` is worse than no image, because it looks like a bug rather than a gap. When \`CreateImage\` fails or the budget is gone, emit the theme's PLACEHOLDER instead — a labelled box saying what the picture should be:

\`\`\`html
<div class="img-placeholder" role="img" aria-label="Photo of the restaurant exterior">Photo: restaurant exterior</div>
\`\`\`

It inherits the theme's colours, so the deck still reads as designed, and the label tells the user exactly what to drop in. Prefer a placeholder over omitting the visual entirely — the slide keeps its intended composition either way.${changeIt}`;
}
