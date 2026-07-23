# AIME — Open-Source Roadmap

> Quarry (nib internal) → **AIME** (open source). This document is the map:
> product definitions, pillars, decision records, phasing, and the de-nib
> checklist. Decided 2026-07-24.

## Product definitions

### Surfaces are lenses; Projects are the container

- **Chat** — conversational AI. No folder, inline artifacts.
- **Cowork** — deep work *with the agent*: real folder, tool transparency
  (Context/Artifacts panels), document deliverables (PDF/PPTX/XLSX), plan
  sheet, canvas. Cowork means co-working with the AI — it is NOT the
  multiplayer feature (see Projects).
- **Code** — developer-shaped cowork; IDE mode (editor, terminals, diffs).
- **Browser** — research/testing with DOM tools.
- **Assistant** — work that runs *without* you: standing orders, widgets.
  Candidate to evolve into **Cockpit** (see DR-2).

### Projects = the durable, shareable scope

A project is the only object that spans surfaces: instructions, knowledge
files, artifact registry, timeline, pinned canvases, folder, conversations.
In AIME it becomes the unit of:

1. **Context** — instructions + knowledge injected into every prompt (exists)
2. **Memory scoping** — memory graph is global + per-project (pillar 5)
3. **Defaults** — per-project model routing overrides, voice profile
4. **Collaboration** — *shared project scope between humans* (pillar 6).
   Sharing is a property of the project, never a surface.

## Pillars

### P1 — Model & provider registry  ⟵ the open-source viability gate

Today: execution engine hardcoded to Claude Agent SDK; models hardcoded
(`sonnet|opus|haiku`), nib gateway aliases, Bedrock env. Outside nib there is
no gateway, so this pillar is first.

Object model:

```
ModelProvider (anthropic | bedrock | vertex | openrouter | fal | ollama | …)
  └─ credentials (BYOK, guided cloud setup, local)
  └─ scanModels() → Model[]
Model { id, provider, capabilities[], contextWindow, pricing }
RoutingTable:  Capability × Tier → Model
  Capability = chat | code | image | search | mesh3d | voice | embedding
  Tier       = cheap | good | smort
RouteSettings { thinkingBudget, warmth, tumbling: Model[], costCompaction }
```

- Surfaces/features request **capability + tier**, never model names.
- **Auto model-tumbling** = generalized fallback chain (exists in embryo:
  `opus→sonnet→haiku` map in claude-provider).
- **Cost compaction** = budget-aware downgrade (generalize the Synaxi
  tag-routing idea from the nib gateway).
- Guided setups: Bedrock, GCP Vertex, local (Ollama/LM Studio), BYOK
  (OpenRouter/FAL/Anthropic direct).

### P0 — Identity & de-nib (prerequisite; mostly deletion)

See checklist at bottom. Rename Quarry→AIME, strip nib infra to config,
rebuild onboarding around P1 provider paths.

### P2 — Surface clarity

Onboarding rework; per-surface default models (via RoutingTable); resolve
DR-1 (Clawish) and DR-2 (Cockpit).

### P3 — Extensibility: MCPs, Skills, Widgets

Strongest existing foundation (connector provisioning, skill parser/gating,
marketplace routes, widget cards). New: **skill generation** ("make me a
skill and save it" → prompt + `serializeSkillMd()`, already tested) and
**widget creation** (generation flow onto `AssistantCard.widget`).

### P4 — Output & intelligence

- **Generalized PDF/document creation with a design system** — replace
  "pip install fpdf2 and wing it" with a document service: bundled
  templates/themes (the PPT plugin pattern generalized).
- **Writing style (voice) creator** — stored style profile injected like
  SOUL.md/USER.md (plumbing exists + tested).
- **Local memory graph** — current memory is flat TF-IDF + Jaccard dedup.
  Graphiti itself is Python+Neo4j (too heavy for local-first Electron);
  take its ideas (temporal edges, entities) on an embedded store
  (SQLite/Kuzu). Scope: global + per-project.
- **Push-to-talk transcription** — nearly free: `use-voice-input` (local
  Whisper) exists; needs a global hotkey via Electron main.

### P5 — Collaboration (last; changes the app's shape)

Shared project scope between humans. Everything today is localStorage/
Zustand on one machine — sharing needs a sync layer (server or CRDT).
Sequence after P1 + Projects hardening. Interacts with DR-3 ($ tier/auth).

## Decision records (open)

| # | Question | Options / lean |
|---|----------|----------------|
| DR-1 | **"Clawish"** — what is it? | Always-on low-friction personal assistant mode. Fifth surface vs. Chat+Assistant merge. UNDECIDED |
| DR-2 | **Cockpit** | Likely = evolution of Assistant surface (widgets + standing orders + ROI dashboard). UNDECIDED |
| DR-3 | **"$7 setup"** — hosted/sub tier alongside BYOK? | Implies auth+billing; couples to P5. UNDECIDED |
| DR-4 | **"Warmth"** | Temperature (model setting) vs. persona tone (voice creator). UNDECIDED |
| DR-5 | **Mesh (3D)** | Capability slot in RoutingTable now; FAL integration later when a use case pulls. LEAN: slot only |
| DR-6 | **Auto-update chain break** | New appId means nib installs won't auto-update to AIME. LEAN: intentional — it's a fork |
| DR-7 | **User-data migration** | localStorage keys `nibcowork:*` → `aime:*` with migration; `~/.quarry` → `~/.aime` with fallback read. LEAN: migrate (cheap, machinery tested) |
| DR-8 | **Opencode provider** | Dormant (unreachable from UI; `initializeProviders()` never called). LEAN: delete with gateway-provider; revisit under P1 registry if a second engine is wanted |

## Phasing

P0 de-nib + rename → P1 provider/model registry + guided onboarding →
P2 surface clarity (DR-1/DR-2) → P3 skills/widgets/MCP polish →
P4 memory graph + voice + PTT + doc service → P5 shared projects.

## De-nib checklist (P0) — ✅ COMPLETE (2026-07-24, commits 90fe812..01903c9)

- [x] Branding module (P0.1) — `web/src/config/branding.ts`
- [x] Surface prompts de-branded (P0.1)
- [x] UI strings (P0.1)
- [x] `package.json` name/productName/appId → aime/AIME/com.aime.app (P0.3)
- [x] Storage keys `aime:*` with legacy read fallback (P0.2, DR-7)
- [x] Data dirs `~/.aime`, `.aime-mcp.json`, Electron userData — one-time renames (P0.2/P0.3, DR-7)
- [x] searxng: `web-search` server, opt-in via SEARXNG_INSTANCES, no internal default (P0.4)
- [x] Gateway removed; BYOK keys route directly to the Anthropic API; settings v7 rename (P0.4)
- [x] teams.json optional — empty example → manual-key onboarding (P0.4)
- [x] Telemetry opt-in, no default endpoint (P0.4)
- [x] Release pipeline → GitHub Releases (build + optional signing); Buildkite/SAMOA/WAF deleted (P0.4)
- [x] Dead code removed: gateway-provider, opencode + SDK dep; JEFF connector; nib-skills; rqp AWS auth → aws CLI (P0.4, DR-8)
- [x] README + CLAUDE.md + SECURITY.md + .env.example rewritten (P0.3/P0.4)
- [x] Guard tests: branding guard on surface prompts; `getAvailableProviders() === ['claude']`

Deliberate legacy-compat remnants (do not "clean up"): gated-storage
nibcowork:* read fallback, `.quarry`/`~/Library/…/Quarry` migration renames,
nib-connector-*/nib-mcp-* config-key reads, `persist:quarry` Electron
partition name (renaming it would orphan renderer localStorage).

Open item for the owner: LICENSE says "Copyright (c) 2026 Composio" —
looks copied from a template; needs the right copyright holder.

## Test suite status (foundation for this work)

352 tests (347 unit + 5 Playwright E2E) green as of the pivot decision;
CI enforces typecheck + unit + E2E. Three production bugs already found by
the suite (js-yaml routing, nav off-by-one, minute-tick double-fire).
The `.planning/STATE.md` + `phases/` files predate this doc (original
build-out); this roadmap supersedes them for direction.
