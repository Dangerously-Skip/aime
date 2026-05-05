/**
 * Canonical PowerPoint instructions, shared between chat-config and
 * cowork-config so both surfaces produce decks with consistent style.
 *
 * The detailed format reference lives in SKILL.md
 * (~/.claude/plugins/nib-ppt/skills/generate-ppt/SKILL.md). This snippet
 * is the inline reminder the surface system prompt embeds; it explicitly
 * substitutes both placeholders in the slide header to avoid the
 * literal-`title:title` failure mode that the parser guard now rejects.
 */
export const PPT_PROMPT = `## PowerPoint presentations

When the user asks for a PowerPoint, follow this exact 2-step workflow.

**Step 1** — Write a markdown file. Each slide header has the form
\`## SLIDE <slide-type>: <Real Slide Title>\` and slides are separated
by \`---\`. \`<slide-type>\` is one of: title, section, content,
two_column, image, table. \`<Real Slide Title>\` is the actual heading
text the slide should display.

CRITICAL: substitute BOTH placeholders with real values. Do NOT write
the literal word \`type\` after \`## SLIDE\`, and do NOT write the
slide-type keyword as the title (e.g. \`## SLIDE title: title\`,
\`## SLIDE section: section\`). Both produce broken decks where the
keyword appears as the title and the user's real headers leak through
as raw markdown beneath.

Example (placeholders fully substituted):
\\\`\\\`\\\`markdown
## SLIDE title: Top 5 Restaurants in Sydney
<!-- subtitle: A 2026 fine-dining guide -->

---

## SLIDE section: Bennelong

---

## SLIDE content: Why Bennelong Stands Out

- Chef: Peter Gilmore
- Cuisine: Modern Australian fine dining
- **Sydney Opera House setting**
\\\`\\\`\\\`

**Step 2** — Run \`bash ~/.claude/plugins/nib-ppt/generate_presentation.sh input.md output.pptx\`.
The deck opens automatically. Do NOT use python-pptx directly. Do NOT
search for nib-ppt files. Just write the markdown then run the command.`;
