---
name: generate-ppt
description: Generate a PowerPoint presentation from markdown content using nib-ppt
allowed-tools: Bash, Write, Read
---

# Generate PowerPoint Presentation

Use this skill to create professional PowerPoint presentations from markdown.

## Workflow

1. Write Fork-formatted markdown content
2. Run `${CLAUDE_SKILL_DIR}/../../generate_presentation.sh input.md output.pptx`
3. Presentation is generated and opens automatically

## Markdown Format

```markdown
## SLIDE title: Presentation Title
<!-- subtitle: Optional Subtitle -->
<!-- authors: Author Name -->
<!-- date: 2024-01-05 -->

---

## SLIDE section: Section Name

---

## SLIDE content: Slide Title

Bullet points:
- Point 1
- Point 2
- **Bold text**

---

## SLIDE two_column: Comparison Title

::: column-left
### Left Side
Content here
:::

::: column-right
### Right Side
Content here
:::

---

## SLIDE image: Visual Slide
<!-- image: path/to/image.png -->

---

## SLIDE table: Data Table

| Header 1 | Header 2 |
|----------|----------|
| Data 1   | Data 2   |
```

## Commands

```bash
# Basic generation
~/.claude/plugins/nib-ppt/generate_presentation.sh input.md output.pptx

# Skip HTML-to-PNG conversion (faster iterations)
~/.claude/plugins/nib-ppt/generate_presentation.sh --skip-html-gen input.md output.pptx

# Don't auto-open
~/.claude/plugins/nib-ppt/generate_presentation.sh --no-open input.md output.pptx
```

## Creating Visuals

For charts, metric cards, and custom graphics — create HTML files and reference them as images. nib-ppt automatically converts HTML to PNG during generation.

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

- Do NOT use python-pptx directly — nib-ppt handles all PowerPoint generation
- Always write Fork-formatted markdown first, then run generate_presentation.sh
- Use relative paths for images
- Keep HTML visuals simple (no JavaScript)

## Dependencies

```bash
pip3 install python-pptx pyyaml playwright jinja2
playwright install chromium
```
