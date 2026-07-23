---
name: brand-guidelines
description: Apply nib Group's brand colors, typography, and visual style to any document, slide, HTML artifact, chart, or visual output. Use this skill whenever the user asks for something to match nib branding, look on-brand, use nib colors, or whenever you're producing a visual artifact (slides, landing page, dashboard, chart) and brand consistency matters. Also applies when the user mentions "corporate style", "our brand", "internal doc styling".
---

# nib Brand Guidelines

Apply nib Group's visual identity consistently across all Quarry-produced artifacts.

## Colors

**Primary palette:**
- **nib Coral** `#FF6B6B` — primary brand color, use for main CTAs, key highlights, brand emphasis
- **Deep Navy** `#1A2B4A` — primary dark, headings, high-contrast text on light backgrounds
- **Cloud White** `#FAFAFA` — primary light, page backgrounds

**Secondary palette:**
- **Teal** `#2EC4B6` — positive metrics, success states, health indicators
- **Amber** `#FFB627` — warnings, attention states
- **Deep Plum** `#6B2C91` — data visualizations, secondary charts
- **Slate** `#475569` — body text on light backgrounds

**Neutrals:**
- `#F4F6F8` — subtle section backgrounds
- `#E5E7EB` — borders, dividers
- `#94A3B8` — muted text, icons
- `#1E293B` — dark mode backgrounds

## Typography

**Font stack:** `"Inter", "SF Pro Display", system-ui, -apple-system, sans-serif`

**Scale:**
- Display XL: `72px / 1.05 / -0.02em` (weight 700)
- Display: `56px / 1.1 / -0.02em` (weight 700)
- Heading 1: `36px / 1.2 / -0.01em` (weight 600)
- Heading 2: `28px / 1.3` (weight 600)
- Heading 3: `20px / 1.4` (weight 600)
- Body: `16px / 1.6` (weight 400)
- Small: `14px / 1.5` (weight 400)
- Micro: `12px / 1.4 / 0.02em` (weight 500, uppercase for labels)

Numbers should use tabular nums: `font-variant-numeric: tabular-nums`.

## Spacing

Consistent 8px grid. Common values: `8, 16, 24, 32, 48, 64, 96, 128`.

## Corners & elevation

- Small radius: `8px` — inputs, small buttons
- Medium radius: `12px` — cards, panels
- Large radius: `16px` — hero sections, dialogs
- Full pill: `9999px` — tags, badges

Shadows (use sparingly):
- Soft card: `0 1px 3px rgba(26, 43, 74, 0.08)`
- Elevated: `0 4px 12px rgba(26, 43, 74, 0.1)`

## Voice

- **Direct and warm** — no jargon, no filler. "We've got you covered" not "We offer comprehensive coverage".
- **Clear numbers and outcomes** — "Pay 15% less" not "Save on premiums".
- **Active voice** — "Choose your cover" not "Cover can be chosen".
- **Short sentences** — Average 12 words. Long sentences are OK occasionally for rhythm.

## Usage rules

**DO:**
- Lead with nib Coral on one focal element per layout (CTA, headline accent, key metric)
- Pair coral with deep navy — this is the signature combination
- Use plenty of whitespace (64px+ between sections on web/slides)
- Left-align text blocks (never center long paragraphs)

**DON'T:**
- Use more than 3 colors in a single artifact
- Use coral on coral (low contrast)
- Center-align paragraphs of body text
- Use drop shadows that are more than 8px blur

## Template: minimal HTML with brand applied

```html
<!DOCTYPE html>
<html>
<head>
<style>
  :root {
    --coral: #FF6B6B;
    --navy: #1A2B4A;
    --white: #FAFAFA;
    --slate: #475569;
    --border: #E5E7EB;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px;
    font-family: "Inter", system-ui, sans-serif;
    color: var(--navy); background: var(--white);
    line-height: 1.6;
  }
  h1 { font-size: 56px; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 24px; }
  h1 .accent { color: var(--coral); }
  p { font-size: 16px; color: var(--slate); max-width: 640px; }
  .cta {
    display: inline-block; padding: 14px 28px;
    background: var(--coral); color: white;
    border-radius: 8px; font-weight: 600;
    text-decoration: none;
  }
</style>
</head>
<body>
  <h1>Clear, <span class="accent">on-brand</span> content.</h1>
  <p>Supporting body copy using brand fonts, spacing, and color.</p>
  <a class="cta" href="#">Primary action</a>
</body>
</html>
```

Apply this skill automatically when producing slides, landing pages, dashboards, HTML artifacts, or anything visual. Do not ask permission — just match the brand.
