---
name: craft-doc
description: Craft rules for printable documents and PDFs — reports, invoices, statements, letters, proposals. Page geometry, break control, greyscale-safe hierarchy and print type scale. Use when the output will be printed or exported to PDF. Not for screens (use craft-web) or slides (use craft-deck).
---

# Craft — printable documents

A document is not a web page with a print stylesheet bolted on. It has fixed
pages, no interaction, and a reader who may be holding it in greyscale.

## Page geometry

Declare the page. Browser defaults are not a design:

```css
@page { size: A4; margin: 18mm 16mm; }
```

Margins below 12mm risk being clipped by the printer's non-printable area. Leave
room at the foot for a page number and a document reference — a page of a
detached report should identify itself.

Line length 65–80 characters. A full-width A4 line is unreadable; use a measure
or a two-column layout.

## Breaks — the failure unique to this medium

Screens scroll, pages do not. Every one of these is a real defect a reader sees:

```css
tr, .row, figure, .card { break-inside: avoid; }
h1, h2, h3            { break-after: avoid; }   /* no heading orphaned at a page foot */
.section              { break-before: page; }
```

Long tables must repeat their header on each page — use a real `<thead>`, which
browsers repeat automatically, rather than styling the first row.

Set `orphans: 3; widows: 3;` on body text.

## It will be read in greyscale

Assume it is. Hierarchy must survive with colour removed, so it has to come from
weight, size, spacing and rules — never from colour alone. Colour is a second
channel on top, not the only one.

The same applies to charts: distinguish series by fill pattern, line weight or
direct labels, not by hue alone. A red/green pair is identical in greyscale and
invisible to a good share of readers regardless.

## Type at print resolution

Print is ~300dpi and screen rules do not transfer. Use physical units — `pt` or
`mm`, not `px`:

- Body 10–11pt. 16px body type looks enormous on paper
- Never below 8pt for footnotes, sources and legal furniture
- Line height 1.35–1.5 for body

A serif body face is a genuinely good choice here in a way it rarely is on
screen — print resolution renders the detail that makes it readable.

Numbers compared down a column need `font-variant-numeric: tabular-nums` and
right alignment. Currency aligns on the decimal. A total is distinguished by
weight and a rule above it, not by a coloured box.

## No interaction exists

Nothing hover-only, nothing that requires a click, no "expand for detail". If a
detail matters it is on the page; if it does not, cut it.

Links must show their destination — the URL in the text or a footnote — because
a printed link is unclickable and otherwise unrecoverable.

Every form field that will be filled in by hand needs a physical line and enough
room for handwriting.

## Document furniture

Real documents carry: a title, a date, a reference or document number, page
`n of m`, and an issuer. An invoice additionally carries payment terms, tax
identifiers and a due date. These are content, not decoration — the document is
a record, and a record missing its identifiers cannot be filed.

## What carries over from craft-web

Colour ration, the specific defaults to avoid, tracking on ALL CAPS, tabular
figures, one spacing scale, and honesty about invented data all apply here
unchanged. Read `craft-web` if the document also has a screen version, and
`craft-deck` if it is going to be projected rather than read at arm's length.
