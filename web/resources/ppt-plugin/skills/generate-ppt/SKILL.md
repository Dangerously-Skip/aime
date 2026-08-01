---
name: generate-ppt
description: Generate a PowerPoint presentation from markdown content using ppt
allowed-tools: Bash, Write, Read
---

# Generate PowerPoint Presentation

Use this skill to create professional PowerPoint presentations from markdown.

## Workflow

1. Write Fork-formatted markdown content
2. Run `${CLAUDE_SKILL_DIR}/../../generate_presentation.sh input.md output.pptx`
3. Presentation is generated and opens automatically

## Markdown Format

Every slide header has the form `## SLIDE <slide-type>: <Slide Title>`,
and slides are separated by `---`.

`<slide-type>` is one of: `title`, `section`, `content`, `two_column`,
`image`, `table`. `<Slide Title>` is the actual title text the slide
should display.

CRITICAL: substitute BOTH placeholders with real values. Do NOT write
the literal word `type` after `## SLIDE`, and do NOT write the literal
slide-type name as the title (e.g. `## SLIDE title: title`,
`## SLIDE section: section`). Both produce broken decks where the
slide-type name shows up as the title and the user's real headers/body
leak through as raw markdown beneath. The slide type and the slide
title are different things — the type is one of the six keywords above,
the title is whatever the slide should be called.

Example (real values, both placeholders substituted):
```markdown
## SLIDE title: Top 5 Restaurants in Sydney
<!-- subtitle: A guide to the city's finest dining experiences — 2026 -->
<!-- authors: Author Name -->
<!-- date: 2026-01-05 -->

---

## SLIDE section: Bennelong

---

## SLIDE content: Why Bennelong Stands Out

Bullet points:
- Chef: Peter Gilmore
- Cuisine: Modern Australian fine dining
- **Sydney Opera House setting**

---

## SLIDE two_column: Bennelong vs Quay

::: column-left
### Bennelong
Iconic Opera House setting
:::

::: column-right
### Quay
Harbour-bridge views
:::

---

## SLIDE image: Bennelong Dining Room
<!-- image: path/to/image.png -->

---

## SLIDE table: 2026 Top 5 — At A Glance

| Restaurant | Chef         | Cuisine             |
|------------|--------------|---------------------|
| Bennelong  | Peter Gilmore| Modern Australian   |
| Quay       | Peter Gilmore| Contemporary tasting|
```

## Commands

```bash
# Basic generation
~/.claude/plugins/ppt/generate_presentation.sh input.md output.pptx

# Skip HTML-to-PNG conversion (faster iterations)
~/.claude/plugins/ppt/generate_presentation.sh --skip-html-gen input.md output.pptx

# Don't auto-open
~/.claude/plugins/ppt/generate_presentation.sh --no-open input.md output.pptx
```

## Creating Visuals

For charts, metric cards, and custom graphics — create HTML files and reference them as images. ppt automatically converts HTML to PNG during generation.

```html
<!-- visuals/metric-card.html -->
<div class="card">
    <div class="value">$14.7M</div>
    <div class="label">Q4 Revenue</div>
</div>
```

Reference in markdown:
```markdown
## SLIDE image: Q4 Revenue
<!-- image: visuals/metric-card.png -->
```

## Rules

- Do NOT use python-pptx directly — ppt handles all PowerPoint generation
- Always write Fork-formatted markdown first, then run generate_presentation.sh
- Use relative paths for images
- Keep HTML visuals simple (no JavaScript)

## Dependencies

```bash
pip3 install python-pptx pyyaml playwright jinja2
playwright install chromium
```
