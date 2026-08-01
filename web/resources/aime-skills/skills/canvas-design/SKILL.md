---
name: canvas-design
description: Create visual artifacts — diagrams, flowcharts, dashboards, landing pages, infographics, and presentation-style slides. Use this skill whenever the user asks to create visual content, wants to show data graphically, mentions canvas, diagrams, charts, slides, or needs any sort of visual artifact that isn't a photograph. Even if they say "make me a picture" or "draw X" or "show this visually", this skill applies.
---

# Canvas Design

Create beautiful visual artifacts using HTML + SVG + CSS. Output goes into an artifact block so it renders live in the AIME canvas panel.

## When to use

- User wants to see something visually: "show me a diagram of...", "create a chart", "make a landing page for..."
- Data or information would be clearer as a visual than as prose
- User says "canvas", "design", "visual", "mockup", "infographic", "slide"
- User asks to "illustrate" something

## Design principles

**Hierarchy.** Make the most important thing the biggest, brightest, or first. Secondary info is smaller and muted.

**Whitespace is a feature.** Don't cram. Padding of 24-48px between sections. Breathing room makes things look polished.

**One accent color.** Pick a single bold color for the focal element, use neutrals (greys, off-whites) for everything else. Too many colors = amateur hour.

**Typography**: Use `system-ui, -apple-system, sans-serif` for body, `'SF Pro Display', system-ui, sans-serif` for headlines. Large display sizes (48-96px) for hero text. Body at 14-16px. Numbers in data should use tabular-nums (`font-variant-numeric: tabular-nums`).

**Contrast.** Dark text on light bg, or vice versa. Don't use grey text on grey bg. Accessible contrast ratios (4.5:1 minimum).

## Output format

Always wrap visual output in an HTML artifact block:

```
:::artifact{title="Title here" type="html"}
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; ... }
    ...
  </style>
</head>
<body>
  <!-- content -->
</body>
</html>
:::
```

The HTML should be **complete and standalone** — all styles inline, no external dependencies unless absolutely needed (Google Fonts are OK via CDN).

## Common patterns

### Flowchart / diagram
Use SVG with `<rect>`, `<circle>`, `<path>` for connectors. Keep shapes simple — rounded rectangles, no drop shadows unless subtle (`filter: drop-shadow(0 2px 4px rgba(0,0,0,0.08))`).

### Dashboard / metrics card
Grid layout with CSS Grid. Each card: label (small, muted uppercase), big number (display font, 48-72px), optional trend indicator. Use `gap: 24px` between cards.

### Landing page
Hero section → benefits → CTA. Use 1200px max width, centered. Sections separated by `padding: 80px 24px`.

### Infographic
Vertical story, one idea per section. Use large icons (SVG), big numbers, short lines of copy. Think "Medium article hero" aesthetic.

### Slide (presentation)
16:9 ratio. Content centered with 80px padding. One big headline + supporting content. Match the user's brand if they've established one.

## Rules

1. **Never** output Lorem ipsum. Use real, useful content based on what the user asked for.
2. **Never** use generic stock photos. Use SVG illustrations, emoji with care, or pure typography.
3. **Always** test that the artifact is self-contained — no broken image links, no external JS that might fail.
4. If the user gives you brand colors or a tone, respect them exactly. Otherwise default to a clean monochrome + one accent palette.
