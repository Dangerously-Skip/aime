---
name: web-prototype
description: Build a self-contained single-page web prototype from a seed template, with a library of section layouts and three ready-made visual tastes. Use for a landing page, marketing page, docs page or SaaS homepage that should look finished. Not for low-fidelity structure work (use wireframe), not for slides (use deck-html), not for print (use craft-doc).
---

# Web prototypes

One self-contained HTML file that looks finished. A seed to start from, section
layouts to assemble, and three tastes if the user has no direction of their own.

## Assets

At `~/.claude/plugins/web-templates/`:

```
web-prototype/assets/template.html     the seed — start here
web-prototype/references/layouts.md    section layouts to paste
web-prototype/references/checklist.md  review pass before you hand it over
taste-brutalist/example.html           Swiss industrial print
taste-editorial/example.html           editorial / magazine
taste-soft/example.html                soft, rounded, consumer
```

**Read the seed before writing anything.** Copy it, then paste sections from
`layouts.md` rather than inventing markup — the layouts are consistent with each
other, and hand-rolled sections are what make a page stop looking like one page.

## Set expectations honestly: this is not the deck system

`deck-html` has 36 themes you swap with one line, because it is a design system
with a token layer. **These are not.** Each taste is a fixed, self-contained
design — three looks, not thirty-six variations. There is no theme file to swap.

So if the user wants a specific look, do not go hunting for a token file. Either
start from the closest taste and edit it, or start from the seed and apply
`craft-web` directly.

## Choosing a starting point

| Situation | Start from |
|---|---|
| The user described a look, or has a brand | `assets/template.html`, then apply their direction |
| No direction, wants something with character | The closest taste, and say which you picked and why |
| Corporate or utilitarian | The seed — the tastes are all opinionated |

When there is no direction and the choice is wide open, offer two or three
directions in a sentence each before building. Picking one silently is how the
model's own default aesthetic becomes the answer to every brief.

## `craft-web` still governs

The taste supplies values; `craft-web` supplies the rules, and the rules win on
anything the taste does not specify:

- neutrals carry 70–90% of the pixels; one accent, twice per screen
- display face differs from body face
- every interactive element: default, hover, focus-visible, disabled
- every data view: populated, **empty, loading, error**
- nothing overlaps, every string fits its box, touch targets ≥ 44px
- no invented statistics, no fake testimonials — an obviously-placeholder label
  beats a plausible fake number, because the plausible one gets shipped

Run `references/checklist.md` before handing over. A prototype that fails its own
checklist is a draft.

## Self-contained

The output is one file with its CSS inline. That is deliberate: it survives being
emailed, opened from disk, or dropped in a message. Do not split out a stylesheet
unless asked, and do not add a build step.
