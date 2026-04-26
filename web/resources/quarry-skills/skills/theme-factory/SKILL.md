---
name: theme-factory
description: Apply a cohesive visual theme (color palette, typography, spacing, mood) to an existing artifact, or generate a new theme from a reference — a brand, a website URL, an adjective ("playful", "premium", "brutalist"), or a mood board image. Use this skill whenever the user asks to "restyle", "theme", "make it look like X", "change the look", "match [brand]", or wants to apply visual consistency across multiple artifacts.
---

# Theme Factory

Generate or apply a themed visual style to HTML/SVG artifacts.

## When to use

- User has an artifact and asks to restyle it: "make this dark", "match [company] brand"
- User gives an adjective: "make it feel more playful/premium/enterprise/brutalist"
- User references another product/site: "like Linear's style", "like Apple's docs"
- User wants multiple artifacts to share a unified look

## Theme = token set

A theme is defined by:

```
colors:
  bg-primary, bg-secondary, bg-elevated
  text-primary, text-secondary, text-muted
  accent-primary, accent-secondary
  border, divider
  success, warning, danger

typography:
  font-display (headlines)
  font-body (paragraphs)
  font-mono (code)
  scale: 12, 14, 16, 20, 24, 32, 48, 72px

spacing:
  4, 8, 12, 16, 24, 32, 48, 64, 96px

radii:
  sm, md, lg, full

shadows:
  soft, raised, floating

motion:
  ease-out, 150ms | 250ms
```

Output these as CSS custom properties under `:root { ... }` and reference them throughout.

## Built-in presets

### Minimal (default)
```
--bg-primary: #FAFAFA; --text-primary: #1E293B;
--accent-primary: #0F172A; --border: #E5E7EB;
--font-display: "Inter", system-ui; --font-body: "Inter", system-ui;
```
Use for: docs, dashboards, professional content.

### Dark
```
--bg-primary: #0F172A; --bg-elevated: #1E293B;
--text-primary: #E2E8F0; --text-muted: #94A3B8;
--accent-primary: #8B5CF6; --border: #334155;
```
Use for: developer tools, data-heavy dashboards, demos.

### Playful
```
--bg-primary: #FFF8F0; --text-primary: #2A1810;
--accent-primary: #FF6B6B; --accent-secondary: #FFD93D;
--font-display: "Fraunces", Georgia, serif; --font-body: "Inter", system-ui;
--radii-lg: 24px;
```
Use for: consumer apps, marketing pages, onboarding.

### Premium
```
--bg-primary: #0A0A0A; --bg-elevated: #1A1A1A;
--text-primary: #F5F5F5; --text-muted: #A0A0A0;
--accent-primary: #C9A961; /* muted gold */
--font-display: "Cormorant Garamond", Georgia, serif;
--font-body: "Helvetica Neue", system-ui;
```
Use for: luxury brands, fintech, high-trust products.

### Brutalist
```
--bg-primary: #FFFFFF; --text-primary: #000000;
--accent-primary: #FF0000; --border: #000000;
--radii-sm: 0; --radii-md: 0; --shadow-raised: 4px 4px 0 #000;
--font-display: "Arial Black", sans-serif;
```
Use for: experimental, statement pages, art.

### nib (brand default)
See `brand-guidelines` skill.

## Generating from a reference

**From a URL:** Fetch the page (via WebFetch), inspect the rendered CSS, extract the dominant color + font + spacing. Reproduce.

**From a brand name:** Use knowledge of that brand's visual language. E.g., "Linear" → purple accent, Inter font, generous whitespace, soft shadows.

**From an adjective:** Map to closest preset + adjust. "Energetic" = Playful preset with stronger accents. "Calm" = Minimal with muted colors.

**From an image/mood board:** Extract top 3-5 colors (eyedropper-style sampling), identify if serif/sans, match radius & spacing feel.

## Applying to an existing artifact

1. Read the current artifact's HTML
2. Identify the CSS tokens being used (colors, fonts, sizes)
3. Replace inline values with CSS custom properties under `:root`
4. Substitute the target theme's token values
5. Return the updated artifact

## Output

Return the restyled artifact as an HTML artifact block. Include a brief note explaining the theme choices (2-3 sentences max).
