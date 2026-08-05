# html-deck — vendored from nexu-io/open-design

Source: `design-templates/html-ppt` in <https://github.com/nexu-io/open-design>
Licence: **MIT** — see `LICENSE`, Copyright (c) 2026 lewis <sudolewis@gmail.com>.
Retrieved: 2026-08-05.

The repository as a whole is Apache-2.0, but this subtree carries its own MIT
licence file, which is what applies here. There is no root NOTICE, so there is
no Apache attribution file to propagate.

## What was taken, and what was not

Taken: `assets/` (base.css, fonts.css, animations, and all 36 theme files) plus
one reference `templates/deck.html`. That is the part with reuse value — each
theme is a pure CSS-custom-property file, so swapping one `<link>` reskins an
entire deck.

Not taken: the other ~90 template folders. They are worth revisiting, but each
is a layout opinion rather than infrastructure, and vendoring ninety of them
before one has been used would be carrying inventory.

## Modifications

None to the vendored files. Any AIME-specific behaviour belongs in the
`deck-html` skill rather than in edits here, so that re-pulling upstream stays a
copy rather than a merge.

## One caveat worth knowing

`fonts.css` loads eight families from Google Fonts by `@import`. Nothing is
bundled, so there is no redistribution question — but a deck rendered with no
network falls back to system fonts. Every theme's `--font-sans` / `--font-display`
already ends in a system stack, so the result degrades rather than breaks.
