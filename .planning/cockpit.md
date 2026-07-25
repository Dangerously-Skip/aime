# DR-2 RESOLVED — Cockpit = the Assistant surface as a widget dashboard

> Owner intent (2026-07-25): *"cockpit should be a place where I can see A2A
> widgets similar to what I have built for Burnbox… It should also show me all
> scheduled runs and allow me to view the outcomes of those scheduled work
> items."*

**Decision: evolve the Assistant surface — do not add a sixth surface.** It
already owns `orders` (standing orders), `cards`, and `activity`; a cockpit is
what that becomes when widget tiles and run history are added.

Three things Cockpit shows:

1. **Widget tiles** — declarative A2UI dashboards, each a saved *recipe*
2. **All scheduled runs** — what is scheduled, when it next fires
3. **Run outcomes** — history + result per scheduled work item

## Prior art: the Burnbox A2UI system (read from source)

Burnbox's widget system is a bespoke declarative JSON catalog — *not* Anthropic's
A2UI/A2A spec, despite the name. Its own header states the design goal:

> *"The agent emits a TREE OF JSON from this trusted catalog; the client renders
> known component types with bound data. It is DECLARATIVE, never executable:
> no HTML, no scripts, no remote URLs."*

**Headline finding: it adds zero dependencies.** No charting library, no layout
library, no schema library. React + CSS + hand-written SVG.

| Asset | Size | Portability |
|---|---|---|
| `a2ui.ts` — 16-node union + `coerceA2Node` validator | 240 ln | verbatim; zero imports |
| `A2UI.tsx` — one recursive `switch` renderer | 148 ln | verbatim (remap class names) |
| `A2Chart.tsx` — pure-SVG bar/line/area/pie | 127 ln | verbatim; zero deps |
| `.a2-*` + `.cockpit-*` CSS | ~146 ln | CSS-variable driven |

Node catalog: `text, metric, statGrid, list, table, keyValue, badge, timeline,
progress, chart, divider, image, actionButton, section, card` (last two are
containers → recursion).

### The four ideas worth stealing

1. **Widget = a stored natural-language recipe, not stored data.** Refresh
   re-runs the recipe as a scoped one-shot agent run and extracts the node from
   the trace. This is the actual innovation.
2. **Coercer as a security boundary.** Untrusted JSON in, valid node or `null`
   out — never throws, *drops*. Depth/children/items/text caps
   (8/60/200/4000). Re-validated **on every render, even from our own DB**
   ("we never trust even our own stored bytes"). Prompt-injection-into-widget is
   real, and images are **data-URL only** — a remote `src` would leak the
   viewer's IP and an egress signal from a "declarative" tile.
3. **Catalog taught in the tool description prose, loose JSON Schema.**
   Counter-intuitive but it works, and the frontend coercer is the backstop.
   Their chart guardrail is worth copying almost verbatim: *"Use a `chart` ONLY
   to compare numeric MAGNITUDES … NEVER for clock times, dates, IDs,
   coordinates, or just 2-3 categories."*
4. **Inline dashboard → "Pin to Cockpit".** An agent renders a dashboard inline
   in chat; a button pins it as a tile, passing the already-rendered node so the
   new tile is never blank. Best discovery mechanism in the design.

Also worth copying: grounded/ungrounded system-prompt split (hard anti-
hallucination rules when a widget has no data source), fast-tier pinning for
refreshes ("short, structured generations"), hard timeout + cancellation token,
per-tile busy state, and an elapsed-seconds counter so a slow first generation
reads as "working (12s)" rather than a frozen spinner.

## Where we deliberately diverge

1. **Real run-outcome records — Burnbox's biggest hole.** Its scheduled refresh
   failures go to `eprintln!` and vanish; a widget that has failed 40 times looks
   identical to one that simply hasn't refreshed. Since the owner explicitly
   asked to *"view the outcomes of those scheduled work items,"* this is the
   centrepiece, not an afterthought. Model it on their `widget_egress` table
   (child table, written every run, shown inline in the tile) but store
   `{status, startedAt, durationMs, error, tokens, toolCalls, deliverable}`.
   **This is the same run-record substrate Clawish needs (C2) — build it once.**
2. **Reconsider CSS-columns masonry.** Elegant and JS-free, but it pins order to
   `created_at` and forbids reordering. If tiles should be arrangeable we need a
   grid + persisted position (`dnd-kit`).
3. **Wire up `onAction`.** Burnbox renders `actionButton` but passes no handler,
   so it is dead. If AIME tiles should be actionable ("re-run this", "open that
   record"), design the action-name → handler dispatch up front.
4. **Consider Zod for the coercer** — we already validate elsewhere; one
   declaration beats 240 hand-maintained lines parallel to the union.

## What AIME already has

- **`canvas-store` + `lib/a2ui/`** — Anthropic A2UI types + renderer, and a
  `canvas` tool already intercepted into an SSE event. Overlapping but *not*
  the same catalog; decide whether to extend `lib/a2ui` or add a
  dashboard-specific catalog beside it.
- **`assistant-store`** — `orders`, `cards` (`AssistantCard.widget` already
  exists), `activity`.
- **`cron-store` + `matchesCron()`**, minute tick, webhooks — the scheduling
  half is real and tested.
- **ROI telemetry** — cost/tokens/duration per run already flow through the
  `done` SSE event, so run records have data to store.

## Proposed slicing

- **K1 — Widget catalog + renderer.** Port the node union + coercer (+ caps,
  data-URL-only images) and the recursive renderer, adapted to shadcn tokens.
  Pure and heavily unit-testable — property/fuzz tests fit the coercer well.
- **K2 — Widget model + recipe refresh.** `Widget {id, title, recipe, render,
  scope, refreshEvery, allowWeb, refreshedAt}`; refresh = scoped one-shot run,
  fast tier, hard timeout, node extracted from the trace.
- **K3 — Run records + outcomes UI** *(shared with Clawish C2)*. Durable
  per-run records for widgets **and** standing orders/cron; per-tile history and
  a "all scheduled runs" view with next-fire times and last outcome.
- **K4 — Cockpit shell.** Assistant surface becomes the dashboard: tile grid,
  per-tile busy/elapsed, live update on refresh.
- **K5 — Inline dashboard → Pin to Cockpit.** Chat-side tool + pin button
  carrying the pre-rendered node.
- **K6 — `onAction` dispatch.** Only once there are real actions to bind.

Order: K1 → K2 → K3 → K4, with K3 pulled earlier if run visibility matters more
than tile variety (it probably does — it's the stated ask).
