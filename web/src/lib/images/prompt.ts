/**
 * Telling the model that image generation exists.
 *
 * This is separate from the deck theme on purpose, and the reason is a bug I
 * shipped: `CreateImage` was advertised in exactly one place — inside
 * `themeInstruction` — which only fires when a deck theme is set. So the tool
 * was invisible for every case it was actually built for. The ask was explicit:
 * "the image functionality would also be very handy if the user is creating a
 * mockup, app or website or document". None of those set a deck theme. Neither
 * does a deck that ends up as pptx, which is how a whole run finished with no
 * pictures and nothing in the log to say why — the tool was never called because
 * nothing had mentioned it.
 *
 * A tool description alone is not enough. The model sees dozens; what makes it
 * reach for one is being told, in the system prompt, that this kind of work
 * wants a picture.
 */

/**
 * @param available whether a credential for image generation resolved. When it
 *   did not, this returns '' rather than advertising a tool that will fail —
 *   inviting the model to try and then handing it an error is worse than
 *   silence, because it spends a turn discovering what we already knew.
 */
export function imageInstruction(available: boolean): string {
  if (!available) return '';

  return `

## Images

You can generate images with \`CreateImage\`. It saves the file alongside whatever you are building and returns a RELATIVE path to embed.

Use it whenever what you are producing is meant to be looked at — a deck, a landing page, a mockup, a prototype, a report cover. A slide or a hero section with a picture reads as finished; the same one without reads as a draft. Describe the SUBJECT and the composition; if a deck theme is set its palette and character are applied for you.

Two rules, both absolute:

- **Never invent an image URL, and never hotlink one you have not fetched.** A broken \`<img>\` looks like a bug, which is worse than an acknowledged gap.
- **When you cannot get an image, leave a labelled placeholder** rather than removing the visual. Dropping it silently makes the layout look intentionally empty, and nobody can tell a missing picture from a design decision. In an HTML deck that is \`<div class="img-placeholder" role="img" aria-label="…">…</div>\`; elsewhere, any clearly-marked box saying what belongs there.

It is capped per turn and each result tells you what you have used, so spend it on the visuals that carry the most — a cover before a bullet slide.`;
}
