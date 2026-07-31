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

Per-surface default models via the RoutingTable ✅ (2026-07-25, `808ac26`);
onboarding rework around provider paths ✅ (2026-07-26, `59805e6` — the last
pre-open-sourcing item); tier-vs-model as the primary control resolved in code
(DR-13 — the picker selects a route, `7998b5a`). DR-1/DR-2 resolved out of this
pillar into **P6** — they turned out to be substrate + a dashboard, not surface
naming. **P2 is complete.**

### P3 — Extensibility: MCPs, Skills, Widgets

Strongest existing foundation (connector provisioning, skill parser/gating,
marketplace routes, widget cards). New: **skill generation** ("make me a
skill and save it" → prompt + `serializeSkillMd()`, already tested) and
**widget creation** (generation flow onto `AssistantCard.widget`).

**DR-9 RESOLVED (2026-07-27): MCP-native, not Composio.** Full analysis in
`dr-9-tool-integrations.md`. Composio holds end-user OAuth tokens server-side
and meters per tool call — both contradict a local-first app with unattended
schedulers, and every OSS user would need their own account. Meanwhile the
Agent SDK already accepts remote MCP (`McpHttpServerConfig` with `headers` and
per-tool `permission_policy`), and the open ecosystem is ~20k servers with
vendors shipping their own OAuth 2.1 endpoints. So P3 invests in being an
excellent MCP client: remote MCP + OAuth, a registry-backed server catalog,
per-tool policy fed by the C3 classifier, and tool-count discipline.
Revisit hosted tool platforms at **P5** (hosted edition) where token custody is
expected — **Nango** over Composio there, since it self-hosts; note its Elastic
License is source-available, so it can never ship in the OSS desktop build.

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

### P5 — Collaboration + companion app (last; changes the app's shape)

Shared project scope between humans. Everything today is localStorage/
Zustand on one machine — sharing needs a sync layer (server or CRDT).
Sequence after P1 + Projects hardening. Interacts with DR-3 ($ tier/auth).

**Mobile companion app (moved here from C6, 2026-07-26).** Rides the same P5
relay/sync server — that shared dependency is exactly why C6 was resolved as
"companion app at P5" rather than messaging channels now. Scope, in ship
order: (1) push notifications for run outcomes and failing goals; (2) remote
APPROVALS for C3's paused consequential actions — the killer feature, since
approving unattended work is most natural from a phone; (3) Cockpit view
(runs, spend, widget tiles — the widget renderer is already pure React and
portable); (4) remote instructions (start a goal/chat from the phone).
Desktop connects OUT to the relay; the phone is a peer client — nothing ever
listens inbound on the user's machine. Remote access is a fair hosted-edition
feature (DR-3): the relay is real infrastructure with real costs.

### P6 — Autonomy & observability (Goals, Runs, Cockpit, Clawish runtime)

Resolves DR-1 + DR-2. Detail in `clawish.md` (C1–C6) and `cockpit.md` (K1–K6).

**The thesis:** OpenClaw (always-on, event-triggered turns), openworker
(outcome as the unit of work, approval-gated), and the Burnbox Cockpit (widget =
a saved recipe re-run on a schedule) all converge on **one missing primitive**:

```
Goal   objective, successCriteria, constraints, approvalPolicy, triggers
 └─ Run      status, startedAt, durationMs, cost, tokens, toolCalls, error
     └─ Deliverable   file | artifact | A2UI node | message
```

Every trigger AIME already owns (minute tick, cron, webhook, manual, chat)
creates a Run against a Goal. Cockpit is a *view* over Goals+Runs. A widget is a
Goal whose deliverable is an A2UI node. Standing orders become Goals. Clawish is
the runtime that executes Goals when no human is present.

**The differentiator:** ROI telemetry (cost/tokens/duration per run) already
flows through the `done` SSE event. Attached to Run records it yields something
none of the three reference tools has — *what your autonomous agents cost and
what they actually produced*. OpenClaw has no economics or dashboard; openworker
has no scheduling, verification, or history; Burnbox has tiles but discards run
outcomes (`eprintln!` and gone).

Status (2026-07-26): **C1/C2** Goals+Runs substrate + durable JSONL log ✅ ·
**K3** Cockpit over runs (cost, health, outcomes) ✅ · standing orders adapted
to Goals ✅ · **K1/K2** widget catalogue + coercer + renderer + recipe refresh ✅
· **C4** verification + retry ("ran, but unmet" is now a visible state) ✅ ·
**C3** approval policy by effect + honest deny; verification wired into the
standing-order executor (the keyword completion hack is dead) ✅ · **K4/K5**
widget tiles in the Cockpit grid + WidgetCreate pin-from-chat ✅ · **C5**
widget schedules run in the SERVER process via a manifest + ticker — refreshes
happen and are recorded with every window closed ✅.

**C5b** ✅ (2026-07-26, `cbed577`) — standing orders execute server-side; the
results inbox replays cards/bus/notifications into the renderer, ack-after-
apply. Retry/escalation auto-invoked by the scheduler ✅ (`fa922b7`), with the
BYOK key mirrored to the keychain so unattended runs have credentials.
P6 is functionally complete. **Not** building: Burnbox's crypto.

**C6 RESOLVED (2026-07-26): a first-party mobile companion app, not messaging
channels.** The hard part of remote access was never the chat UI — it is the
transport (the desktop is behind NAT). OpenClaw's WhatsApp/Telegram channels
are really free relay infrastructure: both ends dial OUT to the platform.
A companion app needs the same relay — which is exactly the P5 hosted-edition
server — and once that exists it beats messaging channels on every axis that
matters here: Cockpit on the phone, real push (run outcomes, failures),
remote APPROVALS for C3's paused consequential actions, proper paired auth
instead of "anyone who can message this number", no third-party ToS/creds.
Remote access via the companion app is a fair hosted-edition feature (the relay
is real infrastructure). Ship order: push notifications → remote approvals →
Cockpit view → remote instructions. Interim recipe for power users: Tailscale +
the headless server's web UI — BLOCKED on adding auth to the local API routes,
which currently have none and must never listen beyond localhost until they do.

### P7 — Craft: the quality of what it makes

P4 gave documents a design system. This pillar does the same for **generated
UI** — the code surface's weakest output, and the one users judge fastest.

Sized against a real comparison: `nexu-io/open-design` composes **50–70 KB** of
context per generation. Our code surface's config is **34 lines**. See DR-16 for
what that context actually contains and why we believe it is the lever.

- **P7.1 Craft rulebooks + precedence ladder.** Brand-agnostic rules
  (typography, colour ration, state coverage, anti-slop) injected into the code
  surface, plus a numbered authority order — user request > skill/design system >
  memory > charter. We have more instruction sources than open-design does
  (`SOUL.md`, `USER.md`, `AGENTS.md`, surface prompt, skills, security rules) and
  no stated ordering between them.
- **P7.2 Seed templates staged into the working directory.** Complete, opinionated
  `template.html` + `layouts.md` + `checklist.md` bundles copied into the scratch
  dir with a mandated pre-flight read. Transfers cleanly because our code surface
  already has a real working directory and file tools — the same mechanism
  open-design uses.
- **P7.3 A closed direction library.** 4–6 presets with literal OKLch values and
  font stacks, bound verbatim, so there is no palette improvisation when the user
  has no brand.
- **P7.4 A deterministic anti-slop linter, WIRED.** Regex-checkable tells
  (default Tailwind indigo, the two-stop gradient, emoji as feature icons, ALL
  CAPS without positive tracking) fed back as a correction turn. Our house rule
  applies — the bar is a failing test, not a careful reading.
- **P7.5 A scoped turn-1 question form.** Hard cap of 5 questions, and ONLY for
  UI-generation briefs: this is a coding surface, and a form in front of "fix
  this bug" is a tax, not a feature.
- **P7.6 The visual feedback loop** — finish the dormant `browser_tool_use`
  bridge so the agent can drive the code surface's own preview pane. Ranked LAST
  deliberately: it is the piece that *sounds* most important and is the one
  open-design does not do at all (DR-16). Blocked on the nonce fix in
  `rendezvous.ts:34-38` — a forged browser-tool result puts attacker text in
  front of the model as fact.

**Measure it.** open-design ships no benchmarks and its own slim-vs-classic
prompt split is unresolved *because* the A/B was never finished. So none of the
above is evidence-backed on output quality. A before/after check on a fixed set
of briefs is part of the pillar, not an optional extra.

## Decision records

| # | Question | Status |
|---|----------|--------|
| DR-1 | **"Clawish"** — what is it? | **RESOLVED (2026-07-25): not a surface — an always-on, event-driven runtime + goal/outcome jobs.** Reference points: **OpenClaw** (self-hosted always-on agent — gateway daemon, disk-backed session store, 30-min heartbeat, multi-source event router where messages/webhooks/hooks/timers/cron all trigger the *same* turn loop) and **openworker** (outcome-oriented — user declares a deliverable, agent decomposes + executes, **approval-gated** before consequential actions, returns finished work). See `clawish.md`. |
| DR-2 | **Cockpit** | **RESOLVED (2026-07-25): evolve the Assistant surface** into a widget dashboard — declarative A2UI widget tiles (Burnbox pattern) + all scheduled runs + viewable per-run outcomes/history. A widget is a stored natural-language **recipe** re-run on a schedule. See `cockpit.md`. |
| DR-3 | **"$7 setup"** — hosted/sub tier alongside BYOK? | **DIRECTION SET (2026-07-26), decided at P5.** Two editions: the **standalone desktop app is open source + BYOK**, and a **hosted, billed edition** for people who either don't want to set up providers *or* want the multiplayer experience. Not a pricing question but an architecture one — hosted means auth, billing, server-held secrets, metering and abuse limits. Deliberately sequenced to P5 because shared projects already drag in hosted data storage and therefore billing anyway, so both land on the same infrastructure rather than paying for it twice. Note the registry work weakened the *usability* case for hosting (OpenRouter with one key reaches most hosted models; local Ollama is free), so this is a business-model and multiplayer decision, not an onboarding fix. |
| DR-4 | **"Warmth"** | **RESOLVED (P1.7): temperature** (a sampling lever, `warmthToTemperature`). Persona/voice stays a SOUL.md concern. |
| DR-5 | **Mesh (3D)** | **RESOLVED (P1.5): implemented**, beyond a slot — real FAL mesh capability calls outside the agent loop. |
| DR-6 | **Auto-update chain break** | **ACCEPTED: intentional** — new appId, nib installs don't auto-update to AIME. It's a fork. |
| DR-7 | **User-data migration** | **DONE (P0.2): migrated** — `nibcowork:*` → `aime:*`, `~/.quarry` → `~/.aime` with fallback read. |
| DR-8 | **Opencode provider** | **DONE (P0.4): deleted** with the gateway provider. Revisit only if a second engine is ever wanted. |
| DR-9 | **Composio integration** | Managed tool-integration platform vs built-in connectors vs Nango. Evaluate in P3. UNDECIDED |
| DR-15 | **Does the browser surface need to run unattended?** | **RESOLVED (2026-08-01): no — attended only.** This was the one question that decided whether the two browser paths merge. Answer is no, so the split stands and is correct on its merits: a client-driven loop is right when a visible browser is on screen and the user can intervene; server-driven SSE is right when the surface owns no browser. Consequences: the browser surface is never a cron/standing-order target; the `browser-turn` route keeps its client loop and only its *inference* moves onto the registry; the SSE `browser_tool_use` bridge is scoped to the code surface's preview pane (P7.6), not to replacing the browser surface. |
| DR-16 | **What actually makes generated UI good?** | **RESOLVED (2026-08-01): context engineering — not sampling params, not a vision loop, not a critique panel.** From reading `nexu-io/open-design` (82.7k stars, Apache-2.0). It never calls an LLM API for generation — it spawns a coding-agent CLI and parses stdout, so there is no temperature, top-p or thinking budget anywhere in it. The levers, in their own ranking: seed templates the model COPIES rather than authors (staged into cwd, up to 110 KB, *"the single biggest reason … the agent isn't re-deriving good defaults each time"*); the design system as a binding token contract (*"the DESIGN.md above is prose; this is the binding contract"*); dense NEGATIVE constraints; a turn-1 question form; a closed direction library with hard-coded OKLch. Three things that look impressive there and are **off or unwired** — worth knowing before copying: the 5-panelist critique jury is `enabled: false` and skipped for Claude Code adapters; the ~1000-line anti-slop linter has **no caller** (the save route returns `lint: findings` and the sole consumer types the response as `{url, path}` and drops them); and there is **no vision loop at all** — no Playwright, no image blocks, one render as the whole budget, justified on token cost. That last finding is why P7.6 is ranked last rather than first. The unwired linter is the same failure mode as `allowedTools`: a control that reads as enforced and isn't. |
| DR-13 | **Tier vs. model as the primary control** | The dropdown pins a model, which *suppresses* tier routing. Is the user-facing lever a tier (Cheap/Good/Smort/Stallion, model-pinning as advanced) or a model (tier stays internal fallback)? LEAN: tier-primary. UNDECIDED |

## Phasing

Pillar numbers are identities, not execution order. Actual sequence:

1. **P0** de-nib + rename — ✅ complete (`90fe812..01903c9`)
2. **P1** provider/model registry — ✅ complete (P1.1–P1.7, `928fad2..d3f4878`)
3. **P2** surface clarity — per-surface defaults ✅ (`808ac26`); provider
   management + model selection ✅ (`63482c1`, `178ae3f`, `0f6952b`)
4. **P2d** effective registry (user models into the capability×tier grid,
   price-band inference), tier grid UI, route-selecting dropdown — ✅ complete.
   Resolves DR-13 and the 345-model scan flood.
5. **P6** autonomy & observability — ✅ complete. Runs substrate → Cockpit →
   widgets → verification → approval policy → out-of-renderer runtime
6. **P2** remainder — onboarding rework around provider paths — ✅ (`59805e6`)
7. **P3** extensibility — ✅ complete (`1160aad..fc03d19`). Resolved DR-9
   (MCP-native, not Composio) and DR-14 (secrets encrypted at rest).
   - P3.1 security floor: registry-validated provisioning (was a local RCE),
     shell injection + traversal in the install route, 0600 everywhere, and
     `access_type=offline` so Google connections survive past the hour
   - P3.2 connectability classification + a shared connect orchestrator.
     Onboarding used to *abandon itself* for 4 of its 5 featured connectors.
   - P3.3 connect at the moment of need — the agent pauses mid-task, an inline
     card connects, and the same turn resumes
   - P3.4 connection health + reconnect; a dead connection no longer reads alive
   - P3.5 the enable/disable toggle made real (it had never done anything), plus
     a visible tool budget
   - P3.6 DCR generalised: add-by-URL behind an SSRF guard, per-tool policy from
     the C3 classifier, and a **probe-verified catalogue of 20 one-click
     servers** (was 3). Re-verify with `npx tsx scripts/probe-dcr.ts`.
   - P3.7 skill generation from a conversation
   - P3.8 DR-14 — see `dr-14-secret-storage.md`
8. **P4** output & intelligence — ✅ complete (`7bb6ff3..399e8bc`)
   - P4.1 push-to-talk via an Electron global shortcut
   - P4.2 document service: markdown → themed HTML → Chromium `printToPDF`,
     replacing "pip install fpdf2 and improvise". Four themes over one base
     stylesheet; CSS *is* the design system.
   - P4.3 memory graph: entities, temporal edges, traversal — Graphiti's ideas
     without Python+Neo4j, as an additive boost over the TF-IDF retriever
   - Writing voice profile (`VOICE.md`), injected like SOUL/USER
9. **P1 remainder** — ✅ complete (2026-08-01). The browser surface had never
   joined the registry: its route built a bare `new Anthropic({apiKey})` against
   a hardcoded model map pinned to a DEPRECATED Claude 4 generation, and required
   a CLIENT-held key. Landed, in the order agreed:
   - (a) inference through the registry — and the recommendation it started from
     was wrong. `getProvider() + maxTurns: 1` does not fit: `QueryParams` takes a
     single `prompt` with no caller-supplied tool schemas, because the Agent SDK
     owns its tool loop. This agent needs the opposite (message array, 17 client
     schemas, `tool_use` executed against a live webview), so it is a raw
     Messages API call by nature. What was wrong was everything around the call.
   - (a2) **the real fix, found by the user**: resolving server-side was not the
     same as the user's settings. Every other surface calls `resolveSendRoute`;
     browser was the forgotten fifth, so on an OpenRouter-only setup it resolved
     against the built-in Anthropic registry and demanded a key that user does
     not have. Now guarded by `send-route-coverage.test.ts`, derived from source.
   - (a3) **Settings became the only place models are set up.** There were four —
     three Settings dropdowns plus a hardcoded default in every surface store.
     The default was the defect: each surface shipped PINNED, so the tier grid
     never got a say. One `modelRoute` representation now makes *unpinned*
     expressible, which is what "follow Settings" means.
     Guarded by `single-setup-point.test.ts`.
   - (b) Bedrock and Vertex work (`lib/models/turn-client.ts`). They live in the
     Agent SDK subprocess's environment, which an in-process HTTP client cannot
     use; it constructs `AnthropicBedrockMantle`/`AnthropicVertex` instead.
   - (c) the duplicated SSE parser and byte-identical store reducers extracted.
   The surface went from **zero tests** to covered, and writing them is what
   surfaced the deprecated model map — nothing had been asserting.

   Carried out of this work, unrelated to the browser: a credential-cache key
   built on `ino:mtimeMs:size` was wrong on Linux, and its nanosecond replacement
   still raced on a CI runner. Both now key on CONTENT. The same shape existed in
   `connectors/health.ts` and would have read a dead connection as alive.
10. **P7** craft — the quality of generated UI (see pillar above)
11. **P5** shared projects + mobile companion (needs a sync layer; interacts with
    DR-3) ⟵ *different in kind: real infrastructure, real cost*

### Known limitations carried into P5

Recorded because these are the first questions an open-source reader asks.

- **PDF printing needs a connected client.** The Next server is a child process
  of Electron and cannot call `ipcMain`, so printing relays through the renderer.
  A *scheduled* run with no window open produces themed HTML, not a PDF.
- **The credential master key sits in the server's environment.** Encryption at
  rest defends the file once it leaves the machine (backups, sync, stolen disk);
  it does not defend against a same-user process. See `dr-14-secret-storage.md`.
- **Entity extraction is heuristic and precision-biased.** It anchors on
  relationship phrasing rather than capitalisation, so it misses mentions like
  "Sarah reviewed the migration". A wrong edge misleads retrieval; a missing one
  only leaves it at keyword parity.
- **Per-tool MCP policy cannot cover stdio servers.** `McpStdioServerConfig` has
  no `tools` field — an SDK constraint. The 7 stdio connectors stay covered by
  `canUseTool` alone.
- **The first session after adding an MCP server has no SDK-level tool policy**,
  since tool names are only known once a session has connected. Closing it needs
  a `tools/list` call at connect time.
- **The voice profile is global only.** The project model says per-project
  defaults should include it; not yet implemented.
- **Naming: "Cowork" needs a decision.** The docs have to disclaim it ("means
  co-working with the AI — NOT the multiplayer feature"), and P5 introduces
  genuine human collaboration alongside it. A name that requires a disclaimer is
  a support burden; renaming is cheap now and expensive after release.

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

LICENSE holder corrected to DangerouslySkip (was a template remnant saying
"Composio" — which incidentally seeded DR-9).

## Test suite status (foundation for this work)

352 tests (347 unit + 5 Playwright E2E) green as of the pivot decision;
CI enforces typecheck + unit + E2E. Three production bugs already found by
the suite (js-yaml routing, nav off-by-one, minute-tick double-fire).
The `.planning/STATE.md` + `phases/` files predate this doc (original
build-out); this roadmap supersedes them for direction.
