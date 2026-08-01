---
name: craft-web
description: Craft rules for generated web UI — colour ration, type scale, state coverage, and the specific defaults that make output look machine-made. Use when building or restyling a web page, app screen, dashboard, form or component. Not for prose, data analysis, backend code, or a deck (use craft-deck).
---

# Craft — web UI

Rules that hold whatever the brand is. If a brand IS configured, its tokens win
on values; these still govern everything the brand does not specify.

## The specific defaults to avoid

Measured, not guessed. These are what this codebase's own eval caught in
generated output, ordered by how often they actually appeared:

**Never pure `#000` or `#fff`** for a surface or body text. Use near-black and
near-white — `#111111` / `#FAFAFA` are safe. Pure values are the single most
consistent tell; they appeared in every sampled run.

**Never the default LLM accent.** `#6366f1`, `#4f46e5`, `#4338ca`, `#3730a3`,
`#8b5cf6`, `#7c3aed`, `#a855f7`. Derive the accent from the brand, the domain, or
a stated direction instead. If there is nothing to derive from, pick a hue with a
reason you can state in one line.

**ALL CAPS needs positive tracking** — `letter-spacing: 0.06em` to `0.1em`.
Uppercase at default tracking reads cramped and is one of the most reliable
signals of unconsidered type.

**No two-stop purple/indigo gradient.** A gradient should carry meaning — depth,
state, a transition — not decoration.

**No emoji as feature icons.** They render differently per platform and read as a
placeholder. Use a real icon set, or omit the icon.

**No rounded card with a coloured left border.** A very recognisable template
shape. Distinguish cards by surface, spacing or type instead.

## Colour

Neutrals carry 70–90% of the pixels. **One accent**, appearing at most twice per
screen — links, hover states and focus rings all count against that budget.
Semantic colours (success, warning, danger) stay under 5% and are used only for
their meaning.

Derive tints with `oklch()` rather than inventing hex values; it keeps lightness
steps perceptually even.

## Type

Display face SHOULD differ from body face. A single family is right only for
utilitarian, data-dense work. `Inter`, `Roboto`, `Arial`, `system-ui` are fine as
BODY faces and weak as display faces — they are the default everywhere, so they
carry no voice.

Three weights is usually enough: 400–450 body, 510–550 UI labels and navigation,
590–600 headings. 700+ is rarely needed.

Tracking: slightly negative on display sizes (32px+), zero on body, slightly
positive on small text and required on ALL CAPS.

Numbers that are compared vertically — tables, metrics, prices — need
`font-variant-numeric: tabular-nums` and right alignment.

## Layout

One spacing scale, applied everywhere. 8px-based (8, 16, 24, 32, 48, 64, 96) is a
safe default.

Left-align blocks of text. Centred paragraphs are hard to read past two lines.

Nothing overlaps by accident; every string fits its box. Oversized display type
(`clamp()` headlines, big numbers) must fit its column — cap it, wrap it, or
widen the column, but never let `white-space: nowrap` push text over a neighbour.

Responsive means redesigned for small screens, not a squeezed desktop layout.
Touch targets ≥ 44px.

## States — the most common omission

Every interactive element: default, hover, focus-visible, disabled. Focus-visible
in particular is routinely dropped and is a keyboard user's only orientation.

Every data view: **populated, empty, loading, error**. Shipping only the
populated state is the most common failure in generated UI. A list that can be
empty will be, on someone's first run.

If the brief does not say what the empty state should say, write something
specific and useful rather than "No data" — it is the first thing a new user
sees.

## Honesty

No invented metrics, no filler statistics, no fake testimonials. If a real value
is unavailable, use an obviously-placeholder label rather than a plausible
number — a plausible fake number gets shipped.
