---
name: brand-guidelines
description: Apply THIS USER'S configured brand — colors, typography, spacing — to a document, slide, HTML artifact or chart. Use only when the user explicitly asks for their brand, names it, or says "on-brand", "our colors", "corporate style". If the Tokens section below is still the unfilled template, this skill has nothing to apply — say so and use theme-factory instead. Do NOT invoke this merely because the output happens to be visual.
---

# Brand Guidelines — template

One place to define a brand so every artifact uses it. **Unfilled by default, and
unfilled means "there is no brand", not "pick one".**

## Why the description above is narrow

This skill previously advertised itself for *"whenever you're producing a visual
artifact (slides, landing page, dashboard, chart) and brand consistency
matters"*, and shipped one specific company's palette. The result: asking for a
generic landing page surfaced a corporate brand nobody had requested, and the
agent offered it as an available capability.

A brand is something a user opts into by name. A skill that applies one on
inference will eventually apply the wrong one, and the user will not know why
their output looks like that.

## Tokens

Replace the placeholders. Delete a line rather than guessing — a missing token is
recoverable, an invented one silently becomes "the brand".

```css
:root {
  /* Core surfaces. Avoid pure #000 / #fff; near-black and near-white read as
     considered, pure values read as untouched defaults. */
  --bg:        /* e.g. #FAFAFA */;
  --surface:   /* raised panels, cards */;
  --fg:        /* body text, e.g. #111111 */;
  --muted:     /* secondary text */;
  --border:    /* dividers */;

  /* ONE accent. A second is almost always a mistake — see the ration below. */
  --accent:    /* primary CTA, key emphasis */;

  /* Semantic, only if the brand defines them. */
  --success:   ;
  --warn:      ;
  --danger:    ;

  /* Type. The display face SHOULD differ from the body face; a single family is
     right only for utilitarian, data-dense work. Avoid Inter/Roboto/Arial as a
     DISPLAY face — they are fine for body. */
  --font-display: ;
  --font-body:    ;
  --font-mono:    ;
}
```

## Rules that hold regardless of the values

Craft rather than brand, so these apply even while the tokens are unfilled.

**Colour ration.** Neutrals carry 70–90% of the pixels. The accent appears at
most twice per screen — links, hover and focus rings all count against that
budget. Semantic colours stay under 5%.

**Type.** ALL CAPS needs `letter-spacing: 0.06em`–`0.1em` or it reads cramped;
display sizes (32px+) want slightly negative tracking. Body copy sits at 400–450,
UI labels 510–550, headings 590–600 — weight 700+ is rarely needed. Numbers in
tables use `font-variant-numeric: tabular-nums`.

**Spacing.** One grid, applied everywhere. An 8px grid (8, 16, 24, 32, 48, 64,
96) is a safe default when the brand does not specify one.

**Elevation.** Depth from a ring or a background shift before a drop shadow.
Heavy shadows date an interface faster than anything else here.

**Layout.** Left-align blocks of text; centred paragraphs are hard to read past a
couple of lines. Give sections room — cramped spacing reads as unfinished.

**States.** Every interactive element needs hover, focus-visible and disabled.
Every data view needs empty, loading and error — shipping only the populated
state is the most common failure in generated UI, and the easiest to notice.

## When there is no brand

Say so, and use the `theme-factory` skill: it generates a coherent palette and
type stack from a reference, an adjective or a mood board. Something coherent is
the goal; something pretending to be a brand it is not is worse than either.
