# web-templates — vendored from nexu-io/open-design

Source: `design-templates/` in <https://github.com/nexu-io/open-design>
Licence: **Apache-2.0** — see `LICENSE`. Retrieved 2026-08-05.

## Why this is a separate directory from html-deck

`html-deck` came from `design-templates/html-ppt`, which carries its own **MIT**
licence file. These directories carry none, so they fall under the repository's
Apache-2.0. Filing them together under one LICENSE would misstate both, so they
are kept apart and each ships the licence that actually applies to it.

Apache-2.0 obligations discharged here: the licence text is included, provenance
and modifications are stated below, and there is no upstream NOTICE file to
propagate (checked — the repo root has none).

## Further attribution

`taste-brutalist/SKILL.md` states it was "distilled from Leonxlnx/taste-skill
`brutalist-skill`". That chain is preserved in the file rather than flattened,
because attribution that stops at the most recent hand is not attribution.

## What was taken

```
web-prototype/     seed template, layout reference, review checklist
taste-{brutalist,editorial,soft}/   three fixed looks
wireframe-{greybox,sketch,annotated,mobile-flow}/   four lo-fi modes
```

Each is standalone — no shared stylesheet, no runtime, nothing referencing a
sibling. That is the difference from `html-deck`, and it is worth stating plainly
because it sets expectations: html-deck is a design SYSTEM (36 swappable token
files over one base stylesheet), whereas these are individual designs. Four
starting points, not a themeable engine. Anyone reaching for these expecting the
deck experience will be disappointed for a structural reason rather than a
quality one.

## What was deliberately NOT taken

The 48 `html-ppt-*` folders. At forty-eight they look like the biggest prize in
the repository and they add nothing: each is `SKILL.md` + one `example.html`
built on the html-ppt system already vendored. No new themes, no new layouts —
example decks. Counting folders is not the same as counting capability.

Document templates (`finance-report`, `pm-spec`, `blog-post`,
`clinical-case-report`, `digital-eguide`) are also left. `craft-doc` covers the
rules; importing five layouts before a real document has failed would be
speculative inventory.

## Modifications

None. AIME-specific behaviour lives in the `wireframe` and `web-prototype`
skills, so that re-pulling upstream stays a copy rather than a merge.
