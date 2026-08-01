---
name: craft-deck
description: Craft rules for slide decks and presentations — slide-scale type, one idea per slide, projected-legibility minimums. Use when producing a deck, slides, or a presentation. Not for web pages or app UI (use craft-web), and not for documents that will be read at arm's length or printed (use craft-doc).
---

# Craft — decks

A deck is not a web page rendered wide. It is read from several metres away, in
a lit room, for about twenty seconds a slide.

## Scale

At 1920×1080:

- Headline **≥ 36px**, and usually far larger — 60–96px reads properly
- Body **≥ 24px**. Anything below this is unreadable projected
- Never below 18px for any text, including captions and sources

If content does not fit at those sizes, the slide has too much on it. Split it.
Shrinking the type to fit is the most common failure and it makes the slide
useless for its actual purpose.

## One idea per slide

The headline should state the idea, not label the topic. "Churn doubled after the
pricing change" beats "Churn analysis". If a reader takes only the headlines,
they should get the argument.

Supporting detail is support: three bullets, not eight. A slide that needs a
paragraph is a document.

## Layout

Generous margins — at least 5% of the slide edge, and keep content out of the
bottom 8% where projectors and heads cut it off.

Align to a grid and keep it consistent across slides; a title that moves 20px
between slides reads as sloppy even when nobody can say why.

One focal element per slide. If everything is emphasised, nothing is.

## Charts

Encode with fills, not bare outlines — a hairline series disappears on a
projector.

Label directly on the data where possible rather than making the reader match a
legend across the slide.

Never more series than the audience can hold: 3–5. Anything more is a table.

## Consistency

The same element means the same thing on every slide — a colour that means
"current quarter" on slide 3 cannot mean "target" on slide 7.

Section dividers earn their place in a long deck and are noise in a short one.

## What carries over from craft-web

Colour ration, the specific defaults to avoid, tracking on ALL CAPS, tabular
figures for compared numbers, and honesty about invented data all apply here
unchanged. Read `craft-web` if the deck contains embedded UI, charts with axes,
or anything that will also be viewed on a screen at reading distance.
