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
9. **P5** shared projects + mobile companion (needs a sync layer; interacts with
   DR-3) ⟵ *next, and different in kind: real infrastructure, real cost*

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
