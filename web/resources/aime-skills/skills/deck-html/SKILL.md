---
name: deck-html
description: Build a presentable HTML deck with one of 36 ready-made visual themes — self-contained, keyboard-navigable, printable to PDF. Use when the user wants a deck to PRESENT or share as a link. Not for a deck they need to edit in PowerPoint (use the pptx workflow), not for web pages (use craft-web), not for printed documents (use craft-doc).
---

# HTML decks

A deck as a single HTML file. Themed by swapping one stylesheet link, navigable
by keyboard, and printable to PDF.

## Choose this or PowerPoint, deliberately

| | HTML deck (this) | `.pptx` |
|---|---|---|
| Recipient can edit it | no | **yes** |
| 36 themes, one-line swap | **yes** | palette and type only |
| Animations, presenter mode | **yes** | no |
| Opens with no software | **yes** (browser) | needs PowerPoint/Keynote |

If the user will PRESENT it or send a link, use this. If someone downstream has
to change a number, they need `.pptx`. When it is genuinely unclear and the
choice would change the deliverable, ask.

## Assets

Everything lives at `~/.claude/plugins/html-deck/`:

```
assets/fonts.css                 8 Google-hosted families
assets/base.css                  layout primitives and the token contract
assets/themes/<name>.css         36 themes — pure CSS custom properties
assets/animations/animations.css 27 named animations
assets/runtime.js                keyboard nav, presenter mode, overview, theme cycling
templates/deck.html              reference deck — read it before writing one
templates/single-page/*.html     31 slide layouts, one per file
```

**Read `templates/deck.html` first.** It is the shape to copy: the class names
are load-bearing because `base.css` and `runtime.js` key off them.

## Layouts — read one before inventing markup

Every slide type you are likely to need already exists in
`templates/single-page/`, as a standalone file using the same classes. Open the
one you want and lift its markup:

| Need | File |
|---|---|
| Opening / closing | `cover`, `thanks`, `cta` |
| Structure | `toc`, `section-divider` |
| Prose and lists | `bullets`, `two-column`, `three-column`, `big-quote` |
| Numbers | `kpi-grid`, `stat-highlight`, `table` |
| Charts | `chart-bar`, `chart-line`, `chart-pie`, `chart-radar` |
| Comparison | `comparison`, `pros-cons`, `diff` |
| Time and sequence | `timeline`, `roadmap`, `gantt`, `process-steps` |
| Diagrams | `flow-diagram`, `arch-diagram`, `mindmap` |
| Technical | `code`, `terminal` |
| Images | `image-hero`, `image-grid` |
| Working lists | `todo-checklist` |

Hand-writing a bar chart or a timeline instead of lifting one is how a deck
stops matching its own theme halfway through: the layouts consume theme tokens,
bespoke markup does not.

Each file is standalone — `<body class="single">` renders one slide full-page.
Inside a multi-slide deck, drop the `single` class and keep the `<section
class="slide">`.

## Building one

1. Copy `templates/deck.html` as the starting point.
2. Rewrite the four asset paths to absolute
   `~/.claude/plugins/html-deck/assets/...` paths, or inline the files if the
   deck must survive being emailed on its own.
3. Set the theme by pointing `<link id="theme-link">` at one of the 36 files.
4. Replace the CONTENT inside the slides. Keep the markup classes.
5. Speaker notes go in a hidden `<aside>`, one per slide.

Do not hand-write CSS for slide layout. The primitives exist; a bespoke grid is
how a deck stops matching its own theme halfway through.

## Themes

Pick by what the deck is FOR, then say why in one line.

- **Corporate / consulting** — `corporate-clean`, `swiss-grid`, `minimal-white`
- **Startup pitch** — `pitch-deck-vc`, `aurora`, `sunset-warm`
- **Editorial / narrative** — `editorial-serif`, `magazine-bold`, `midcentury`
- **Technical / engineering** — `blueprint`, `engineering-whiteprint`, `sharp-mono`, `terminal-green`
- **Academic** — `academic-paper`, `japanese-minimal`
- **Developer-familiar palettes** — `nord`, `dracula`, `tokyo-night`, `gruvbox-dark`, `catppuccin-latte`, `catppuccin-mocha`, `rose-pine`, `solarized-light`
- **Expressive / retro** — `bauhaus`, `memphis-pop`, `neo-brutalism`, `vaporwave`, `y2k-chrome`, `retro-tv`, `cyberpunk-neon`, `rainbow-gradient`
- **Soft / consumer** — `soft-pastel`, `glassmorphism`, `arctic-cool`, `xiaohongshu-white`, `news-broadcast`

A theme is a decision. State it: "swiss-grid — dense financials, so a strict grid
and a single red accent."

## The rules still apply

`craft-deck` governs the CONTENT whatever the theme: headline states the idea
rather than labelling the topic, one idea per slide, three bullets not eight,
direct labels on charts instead of a legend, and type large enough to read from
the back of a room. A theme makes a deck look considered; it cannot make a
slide with eleven bullets a good slide.

Never override a theme's colours with hardcoded hex values. If the accent is
wrong for the deck, pick a different theme — an overridden token is a deck that
stops matching itself the moment someone swaps the theme.

## Exporting

Print to PDF from the browser at landscape 16:9. Slides are page-broken already.
For `.pptx`, this is the wrong format — build it with the PowerPoint workflow
from the start rather than converting.

## Offline

`fonts.css` pulls eight families from Google Fonts. With no network the deck
falls back to system stacks — every theme's font list ends in one, so it
degrades rather than breaks. If a deck must look identical offline, inline the
font files and say that is what you did.
