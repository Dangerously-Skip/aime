/**
 * Which deck-building plugins a run may see.
 *
 * The user reported the same thing three times: they pick a design in
 * Customize → Design, ask for a deck, and get a plain unstyled `.pptx`. Three
 * different causes were found and fixed — the instruction did not steer the
 * format, the auto-continue path dropped `deckTheme` from the request, and a
 * fall-through branch discarded the instruction when there was no prompt to
 * append it to. After all three, it still happened.
 *
 * Because the remaining lever was prose. The system prompt says "do NOT reach
 * for the pptx workflow", and the `ppt` plugin sits right there offering
 * `ppt:generate-ppt` to a model that is not obliged to read carefully. This
 * codebase has learned that lesson twice already — a security toggle that
 * filtered an auto-approve list, and a rule telling the model not to guess URLs
 * — and the conclusion was the same both times: **a claim with no mechanism
 * behind it is not a control.**
 *
 * So when a theme is set, the pptx plugin is not offered. Not discouraged: absent.
 *
 * The exception is the one case where prose is genuinely the right instrument —
 * the user naming the format themselves. "Make me a PowerPoint" is unambiguous,
 * and refusing it because a theme happens to be set would trade one wrong
 * default for another.
 */

/** Plugin directory names that build `.pptx` rather than HTML decks. */
const PPTX_PLUGINS = new Set(['ppt', 'powerpoint', 'pptx']);

/**
 * Did the user ask for PowerPoint by name?
 *
 * Deliberately narrow. It matches the FORMAT being named, not the topic being
 * about presentations — "build me a slide deck" is the request that has been
 * producing the wrong output, and it must NOT match here, or the mechanism
 * turns itself off for the exact case it exists to handle.
 */
export function asksForPptx(prompt: string | null | undefined): boolean {
  if (!prompt) return false;
  return /\b(powerpoint|pptx|\.ppt\b|ppt file|keynote|editable (?:deck|presentation|slides))\b/i.test(
    prompt,
  );
}

/**
 * Filter the plugin list for this run.
 *
 * @param pluginPaths absolute paths, one per installed plugin.
 * @param themeId the resolved deck theme, or null when none is set.
 * @param prompt this turn's user message.
 */
export function allowedPluginPaths(
  pluginPaths: readonly string[],
  themeId: string | null | undefined,
  prompt: string | null | undefined,
): string[] {
  // No theme means no opinion: the user has not chosen a design, so the model
  // picking pptx is a legitimate choice rather than a discarded preference.
  if (!themeId) return [...pluginPaths];
  if (asksForPptx(prompt)) return [...pluginPaths];

  return pluginPaths.filter((p) => {
    // Split on BOTH separators. `scanPlugins` builds these with `path.join`,
    // which yields backslashes on Windows — so `split('/')` returned the whole
    // `C:\Users\…\plugins\ppt` string as the "name", nothing matched
    // PPTX_PLUGINS, and a Windows user with a theme set got the unstyled .pptx
    // this function exists to withhold. No log line either, so it read as the
    // model ignoring the instruction.
    const name = p.split(/[\\/]/).filter(Boolean).pop() ?? '';
    return !PPTX_PLUGINS.has(name.toLowerCase());
  });
}
