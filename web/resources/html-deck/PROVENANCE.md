# html-deck — vendored from nexu-io/open-design

Source: `design-templates/html-ppt` in <https://github.com/nexu-io/open-design>
Licence: **MIT** — see `LICENSE`, Copyright (c) 2026 lewis <sudolewis@gmail.com>.
Retrieved: 2026-08-05.

The repository as a whole is Apache-2.0, but this subtree carries its own MIT
licence file, which is what applies here. There is no root NOTICE, so there is
no Apache attribution file to propagate.

## What was taken, and what was not

Taken: `assets/` (base.css, fonts.css, animations, and all 36 theme files),
`templates/deck.html`, and all 31 of `templates/single-page/`.

The single-page layouts were left out at first, on the reasoning that they were
"layout opinions rather than infrastructure". That was wrong, and the list is
what shows it: chart-bar, table, timeline, kpi-grid, comparison, flow-diagram.
Those are the layout VOCABULARY of the system, not opinions about it — and
without them a model asked for a chart writes its own markup, which consumes no
theme tokens and so stops matching the theme it is inside.

Not taken: the other ~90 top-level template folders (landing pages, dashboards,
reports). Those genuinely are individual designs rather than infrastructure, and
belong to a separate decision about whether AIME produces HTML for those media
at all.

## Modifications

None to the vendored files. Any AIME-specific behaviour belongs in the
`deck-html` skill rather than in edits here, so that re-pulling upstream stays a
copy rather than a merge.

## One caveat worth knowing

`fonts.css` loads eight families from Google Fonts by `@import`. Nothing is
bundled, so there is no redistribution question — but a deck rendered with no
network falls back to system fonts. Every theme's `--font-sans` / `--font-display`
already ends in a system stack, so the result degrades rather than breaks.
