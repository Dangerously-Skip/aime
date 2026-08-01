---
name: web-artifacts-builder
description: Build rich, interactive HTML artifacts — multi-page web apps, dashboards with real interactivity, games, prototypes, visualizations with user controls. Use this skill whenever the user wants something that needs to *work* in the browser (buttons that do things, forms, live charts with toggles), not just a static design. Also triggers on "build me a", "prototype", "working demo", "interactive".
---

# Web Artifacts Builder

Produce self-contained interactive HTML artifacts that run in AIME's canvas panel (iframe sandbox, scripts allowed).

## What makes this different from canvas-design

- **canvas-design** = pretty pictures, static visuals, slide-like artifacts
- **web-artifacts-builder** = things that respond to user input, have state, update over time

If the output has a single button that does anything interesting, use this skill.

## Constraints

The artifact runs in a sandboxed iframe with `sandbox="allow-scripts"`. That means:
- JavaScript runs, including modules via `<script type="module">`
- No network access to authenticated APIs (no cookies)
- No localStorage persistence across reloads (use in-memory state)
- No top-level navigation (links with `target="_blank"` are OK)
- CDN imports work (e.g. unpkg.com, esm.sh, cdn.jsdelivr.net)

## Tech choices

**For UI:** Plain HTML + vanilla JS is the default. Only reach for React/Vue if the component tree genuinely needs it.

**For charts:** Chart.js via `https://cdn.jsdelivr.net/npm/chart.js` or D3 via `https://d3js.org/d3.v7.min.js`.

**For icons:** Lucide via `https://unpkg.com/lucide-static/icons/[name].svg` or inline SVG.

**For styling:** Inline `<style>` or use Tailwind via `https://cdn.tailwindcss.com`.

**For 3D:** Three.js via `https://unpkg.com/three@0.160/build/three.module.js`.

## Output format

Always use an HTML artifact block:

```
:::artifact{title="Name of the thing" type="html"}
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>...</title>
  <style>...</style>
</head>
<body>
  <!-- UI -->
  <script>...</script>
</body>
</html>
:::
```

## Patterns

### Interactive dashboard

```html
<div id="app"></div>
<script>
  const state = { filter: 'all', data: [...] };
  function render() { document.getElementById('app').innerHTML = `...`; }
  function onFilter(f) { state.filter = f; render(); }
  render();
</script>
```

Keep state in a single object. `render()` is idempotent — it reads state, regenerates DOM.

### Form prototype

Use `<form>` with `onsubmit="return handleSubmit(event)"`. Validate inline. Show success state by replacing the form, not alerting.

### Live chart with controls

Chart.js with an array of sliders/toggles that update chart data and call `chart.update()`.

### Game / simulation

`requestAnimationFrame` loop, canvas element, keyboard events on `window`. Keep to 60fps.

## Quality rules

1. **Keyboard accessibility** — all interactive elements focusable via tab, visible focus ring
2. **Mobile-friendly** — use responsive CSS, buttons at least 44px tall
3. **No console errors** — check for typos before outputting
4. **Instant feedback** — user actions show results within 100ms
5. **Reset is always possible** — if state can get bad, include a "Reset" button

## Styling defaults

Use `brand-guidelines` skill colors/fonts if the user has established brand, otherwise:
- Background: `#0F172A` (slate 900) or `#FAFAFA` (light)
- Accent: `#8B5CF6` (violet) — nice default for demos
- Text: `#E2E8F0` on dark, `#1E293B` on light
- Font: `system-ui, -apple-system, sans-serif`
- Border radius: `8-12px`
- Transitions: `150ms ease` on hover/focus states

## Do NOT

- Produce HTML with `<script src="...">` pointing to paid/gated APIs
- Add analytics, tracking, or anything that calls out to third parties
- Embed iframes of real websites (most block with X-Frame-Options)
- Use `alert()`, `prompt()`, `confirm()` — build proper UI instead
- Make the artifact longer than it needs to be — concise > comprehensive
