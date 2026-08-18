# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AIME (formerly Quarry — open-source rename in progress, see `.planning/aime-roadmap.md`) is an Electron desktop AI workspace powered by the Claude Agent SDK. Product name lives in `web/src/config/branding.ts` (`APP_NAME`) — never hardcode it. Built with Next.js 16, React 19, and shadcn/ui in the `web/` directory. Five surfaces (Chat, Cowork, Code, Browser, Assistant) with real-time streaming via SSE, OAuth connectors exposed as MCP tools, agent routing, standing orders/automation, memory extraction, ROI telemetry, and document processing (PDF, DOCX, XLSX, PPTX, audio, video).

## Development Commands

```bash
cd web && npm run electron:dev   # Start Next.js dev server + Electron
cd web && npm run typecheck      # Run tsc --noEmit (run before shipping)
cd web && npm test               # Run unit tests (Vitest)
cd web && npm run test:watch     # Vitest watch mode
cd web && npm run dist           # Build macOS app (next build + electron-builder)
```

Run `npm run typecheck` and `npm test` before commits and ships. No extra local
config is needed: a fresh clone typechecks after `npm install`.

## CI runs on elastic runners, and one detour is worth knowing about

`ci.yml` targets `runs-on: ${{ vars.FAST_RUNNER || 'self-hosted' }}`, with the
repo variable set to `blacksmith-4vcpu-ubuntu-2404`. The fallback is deliberate:
if the variable is ever unset the self-hosted path still works rather than
hard-failing.

**The detour, because the reasoning was sound and the conclusion still wrong.**
GitHub-hosted runners genuinely could not start, so `ubuntu-latest` jobs never
ran and every push went ungated. The mechanism was narrower than the "recent
account payments have failed" message suggested: the org's 2,000 free minutes
were exhausted, **1,912 of them by one repo's per-PR macOS jobs at a 10× quota
multiplier**, after which every hosted job org-wide failed at ASSIGNMENT — zero
steps, no log. The fix was an org-wide sweep onto `[self-hosted, linux]`, three
runners on the Contabo box (`redacted-host`).

That traded *never runs* for *runs and fails*, on the box that serves production.
24 of the following 25 runs failed, neither cause this repo's code:

  - `e2e` — `libgtk-3.so.0: cannot open shared object file`. Electron could not
    launch. The workflow asserted those OS libraries had been provisioned on the
    box by hand instead of via `--with-deps`; they had not been, and nothing
    verified it. GitHub's Ubuntu images ship them, a bare Contabo box does not.
  - `test` — 3 failures out of 2803 on a box at load 20–40, with `environment
    325s` / `import 323s` reported for a 174s suite. Arithmetic, not flakiness.

**What survives from that period and should not be "cleaned up":**
`vitest.config.ts` sets `testTimeout`/`hookTimeout` to 30s. Five tests failed on
the 5s default — the fast-check property suites and the SSE route test — with no
bug involved. The default was a fast-laptop assumption; keep the 30s.

**Still cannot run:** `release.yml`'s `build-mac` and `build-win` need macOS and
Windows runners. Deliberate, and noted in that workflow.

### Migrating another repo in the org

Set a repo-level `FAST_RUNNER` variable (org-level variables never reach private
repos — the API returns 200, the value shows in the listing, and workflows
silently use the fallback). Sync with
`~/dev/tools/launchpad/bin/ci-runner-sync.sh --apply`.

Leave alone: `macos-*`/`windows-*` (need those OSes), `*-arm` (the pool is X64),
and matrix-driven `runs-on` (the fix belongs in the matrix).

**Push over git/SSH, not the API.** `gh api` refuses to write under
`.github/workflows/` — *"refusing to allow an OAuth App to create or update
workflow … without `workflow` scope"* (and 404s elsewhere, which is GitHub
masking a 403). A plain `git push` is not subject to that scope check.

### Two ways a test can pass here and fail only in CI

Both cost a red `test` job, and neither reproduces on a Mac by running the suite
again. Look for these shapes before calling it a flake.

1. **A file identity that is unique on APFS but recycled on ext4/overlayfs.**
   `rm` then recreate REUSES the inode on Linux, routinely. A cache keyed on
   inode is then keyed on nothing — and if it also uses millisecond mtime, two
   writes in the same tick with equal-length payloads collide on every component.
   That shipped in `probeCredentialFile`'s memo, complete with a comment
   asserting the opposite. Key on `ctimeNs` (bigint `statSync`): it moves on
   creation even when an inode is recycled, and cannot be set.

2. **A magic system path standing in for "this write must fail."** Node's
   recursive `fs.mkdir` on a nonexistent `/proc` subpath never settles inside a
   Linux container — measured still pending at one hour, where `/tmp` resolves in
   1ms. On macOS it fails fast because `/proc` does not exist, so the test looks
   fine locally and burns the whole `testTimeout` in CI. Busybox `mkdir -p` on
   that same path returns ENOENT immediately, so reasoning about the syscall does
   not predict it. Make the parent a regular FILE instead: ENOTDIR, instantly,
   everywhere. And assert the failure path actually ran (spy the log line) —
   otherwise a path that turns out to be writable passes while proving nothing.

### What gates a push

**Run `npm run hooks:install` once per clone.** Nothing else here is a gate.

CI is advisory in the strict sense — it reports, and nothing stops a red run
from reaching `main`. Not a policy choice: this repo is private in a Free org,
where both enforcement mechanisms are refused outright.

```
GET /repos/Dangerously-Skip/aime/rulesets                  -> 403
GET /repos/Dangerously-Skip/aime/branches/main/protection  -> 403
"Upgrade to GitHub Pro or make this repository public to enable this feature."
```

So `.githooks/pre-push` (opt-in, tracked, `npm run verify` — typecheck → lint →
unit → build, ~70s) is the ONLY thing that can stop broken work. It is opt-in on
purpose: a hook that installs itself breeds reflexive `--no-verify`, which is
worse than no hook. `SKIP_VERIFY=1 git push` and `--no-verify` both work and
neither is silent.

`ci-structure.test.ts` derives CI's `test` job steps from `ci.yml` and fails if
`verify` does not cover all of them, so a new CI step cannot silently stop being
gated locally. It also fails if the hook loses its execute bit — git skips a
non-executable hook in total silence, so the failure mode is no output at all.

**The way out is to make the repo public** (rulesets become free, and the
open-source rename is already the plan) or GitHub Team at $4/user/mo. Either one
turns the advisory checks into real ones; until then the hook is the story.

`test` (typecheck → lint → unit → **build**) and `e2e` run on every push and PR.
`mutation` runs weekly and on `workflow_dispatch` only — a slow check on every
push is a check people learn to skip.

The **build** step earns its place: `tsc --noEmit` and the whole unit suite pass
for a Next.js client/server boundary violation. A client component importing a
module that reaches `fs` fails only in `next build`. That shipped once —
`provider-manager.tsx` → `lib/models/credentials` → `app-paths` → `fs` — with
typecheck and 2777 tests green.

### Testing

Unit tests use Vitest (`web/vitest.config.ts`, node environment by default, `@/` alias). Test files live next to the code they test (`*.test.ts`); React hook/component tests use jsdom via a `// @vitest-environment jsdom` pragma and Testing Library. E2E smoke tests use Playwright (`web/playwright.config.ts`, specs in `web/e2e/`, boots `next dev` on port 3100): `npm run test:e2e`.

Every code change should include tests: unit for logic, and a regression test reproducing the bug first for bug fixes. Existing coverage: slash commands, cron matching, ROI calc, artifact parsing/categorization, server detection, AGENTS.md parsing, SKILL.md parsing, standing-order import/engine, SSE streaming (server + client hook), memory retriever/dedup, store actions (conversation, cowork, assistant, context-bus, memory), settings migrations (v1→v7 via real rehydrate), minute-tick hooks (cron, heartbeat), API routes (cron, webhooks CRUD + trigger), ClaudeProvider (SDK mocked: option assembly, session resumption, stream translation, canUseTool governance/loop-detection/interception), the chat SSE route (validation, streaming, tool profiles, agent routing, security injection, memory extraction), canvas templates (registry + expansion), gateway/bedrock env mapping, pending-questions bridge, xlsx extractor (real files), and browser-boot smoke E2E.

### Security controls: the bar is a failing test, not a careful reading

Four security toggles once shipped doing nothing — `disableBashTool` said it
"completely removes the Bash tool" while filtering a name out of the SDK's
*auto-approve* list on a run with `permissionMode: 'bypassPermissions'`, so Bash
kept working. All four had passing tests. The tests asserted the list had been
filtered, which was true and irrelevant.

The general principle ("don't mock the boundary a test exists to prove") was
already written down when all four shipped, so more prose is not the fix. Two
mechanisms are, and both fail the build rather than asking you to remember:

1. **`enforcement: 'enforced' | 'guidance'`** on every entry in
   `SECURITY_TOGGLES` (`settings/sections/security-section.tsx`). Declaring
   `'enforced'` is a claim `security-section.enforcement.test.ts` checks by
   driving the real `canUseTool` — the one hook that runs whatever
   `permissionMode` says. A new enforced toggle with no probe fails. The badge is
   rendered in Settings, so the claim is visible to the user too.
2. **`npm run test:mutation`** (Stryker, scoped to `lib/security/**`,
   `path-containment.ts`, `tool-policy.ts`; weekly in CI, never per-push). A green
   suite says the code ran; only this says the assertions would notice if it
   stopped working.

**Definition of done for a change to a user-facing security control:** disable
the enforcement, run the suite, name the tests that fail, restore it — and put
those test names in the commit message. If nothing fails, the control is not
enforced yet, whatever the label says.

The recurring shape to watch for: a claim in the UI, a system prompt, or a
dropdown with no server-side refusal behind it. `allowedTools` is the classic
trap — it is an auto-approve list, so narrowing it restricts nothing; use
`deniedTools`. And its complement is *not* a deny list: those arrays have never
been exhaustive (`WidgetCreate` is on none of them and works everywhere).

## Architecture

**Next.js + Electron** (all code in `web/`):

1. **Electron Main** (`web/main-web.js`) — Window lifecycle, IPC handlers, auto-updater, minute-tick heartbeat, GitHub OAuth
2. **Electron Preload** (`web/preload-web.js`) — IPC bridge via `contextBridge` (file dialogs, auth windows, notifications, updates, `onMinuteTick`)
3. **Next.js App** (`web/src/`) — React UI with shadcn/ui, Zustand stores
4. **API Routes** (`web/src/app/api/`) — SSE streaming, connectors, telemetry, identity, memory, webhooks, cron, subagents

### Surfaces (`web/src/components/surfaces/`)

- `chat/` — Conversational chat with attachments, web search, model selection
- `cowork/` — Agent workspace with folder picker, Context + Artifacts + SearchResults sidebar, plan sheet, canvas panel
- `code/` — Code-focused surface with artifact management
- `browser/` — Built-in browser for research and testing with DOM tools
- `assistant/` — Standing orders, automation templates, order editor

### Stores (`web/src/stores/`)

- `app-store.ts` — Active surface, sidebar, theme
- `chat-store.ts` — Chat messages, streaming, tool calls, session controls
- `cowork-store.ts` — Cowork messages, contextFiles, artifactFiles, folders (per-conversation)
- `code-store.ts` — Code artifacts, execution, editor state
- `browser-store.ts` — Browser DOM state, navigation, tool results
- `assistant-store.ts` — Standing orders, automation templates
- `conversation-store.ts` — Conversation list, metadata, tokenUsage, effortEstimate, ROI, ratings
- `settings-store.ts` — User preferences (v6, persisted)
- `project-store.ts` — Projects, artifacts, per-project settings
- `connector-store.ts` — Connected service status
- `canvas-store.ts` — A2UI canvas panel state
- `cron-store.ts` — Cron jobs + `matchesCron()`
- `heartbeat-store.ts` — Connection health
- `memory-store.ts` — Memory extraction/retrieval
- `context-bus-store.ts` — Inter-component event bus
- `reminder-store.ts` — Task reminders

### API Routes (`web/src/app/api/`)

**Core:** `POST /api/chat/[surfaceId]` (SSE streaming with agent routing), `POST /api/abort`, `GET /api/providers`, `GET /api/models`, `GET /api/health`, `GET /api/doctor`, `GET /api/surfaces`

**Identity & Memory:** `GET|POST /api/identity/user-md`, `GET|POST /api/identity/soul-md`, `POST /api/memory/daily`

**Telemetry:** `POST /api/telemetry/events`, `POST /api/telemetry/estimate-effort`, `GET /api/settings/costs`

**Connectors:** `/api/connectors/oauth/*`, `/api/connectors/provision`, `/api/connectors/status`, `/api/nango/*`

**Customization:** `/api/customize/connectors/*`, `/api/customize/plugins`, `/api/customize/skills/*`, `/api/marketplace`

**Automation:** `GET|POST|DELETE /api/cron`, `GET|POST|DELETE /api/webhooks`, `POST /api/webhooks/[token]`, `POST /api/subagent`, `POST /api/subagent/batch`, `POST /api/session/reset`, `GET /api/agents`

**Files:** `/api/files/read`, `/api/files/delete`, `/api/files/search`, `POST /api/upload`

**Auth:** `GET /api/auth/github`, `GET /api/auth/github/callback`

**Search:** `GET /api/search-proxy`

**GitHub:** `GET /api/github/repos`

### Providers (`web/src/lib/providers/`)

- `claude-provider.ts` — The provider (Claude Agent SDK). Injects MCP servers (connectors + optional `web-search` searxng + in-process `aime` server), handles tool interception (canvas, spawn_agent, loop detection), session controls.

### Models are configured in exactly one place, and two tests hold that line

The tier grid in Settings is where the user says which model fills each
capability×tier slot; their BYOK providers populate the catalog it chooses from.
Every surface then resolves through **`resolveSendRoute`**. That is the entire
contract, and it is easy to break by accident in two directions:

1. **A surface that skips the chokepoint** does not run "a slightly different
   model" — it resolves against the BUILT-IN Anthropic registry and then demands
   an Anthropic key. For an OpenRouter-only user that surface is simply dead
   while every other one works. The browser surface shipped exactly this, for
   months, and `resolveSendRoute`'s own comment had warned about it in prose
   ("all four call this function and one forgetting is how the gap appeared").
   Prose cannot fail a build; `send-route-coverage.test.ts` can, and derives both
   sets from source so a new surface is covered without anyone remembering.
2. **A second place to pick a model.** There were four — three Settings dropdowns
   plus a hardcoded default in every surface store. The default was the real
   defect: each surface shipped PINNED, so the tier grid never got a say.
   `single-setup-point.test.ts` forbids both halves — no store may expose
   `model`/`setModel`, and no Settings section but the tier grid may render a
   model chooser.

Corollary worth keeping: a selection is stored as ONE `modelRoute` — tier,
built-in, or provider model alike. That is what makes *unpinned* expressible, and
unpinned is what "follow Settings" means. Browser is stricter still: no picker,
no route, no stored model.

`lib/models/turn-client.ts` is where the raw-Messages-API path (browser only)
picks its client. Bedrock and Vertex live in the Agent SDK's subprocess
environment, so an in-process HTTP client cannot use them — it constructs
`AnthropicBedrockMantle`/`AnthropicVertex` instead. Both THROW on incomplete
config, hence the try/catch at the call site; that is not defensive habit.

### Key Libraries (`web/src/lib/`)

- `slash-commands.ts` — `/think`, `/verbose`, `/reasoning`, `/model`, `/agent`, `/help` — parses into `SessionControls`
- `agents-parser.ts` — Loads `AGENTS.md` from `~/.claude/` + cwd, matches on triggers or `sessionControls.agentName`
- `a2ui/` — Anthropic A2UI canvas type system (`types.ts`) + renderer (`renderer.tsx`)
- `telemetry/` — `roi.ts`, `analytics-client.ts` (SigV4), `event-buffer.ts` (JSONL)
- `memory/` — `extractor.ts`, `retriever.ts`, `summarizer.ts`
- `connectors/` — OAuth flow, credential storage (env-driven), provisioner, registry (GitHub, Slack, Atlassian, Figma, Google, M365, Miro, Zoom, Buildkite, SumoLogic, Snowflake, AWS)
- `extractors/` — PDF, DOCX, XLSX, PPTX, audio, video content extraction
- `surfaces/` — Per-surface config (allowed tools, system prompts). Cowork config has web search prompt directing to the `web-search` MCP
- `standing-order-engine.ts` / `standing-order-templates.ts` — Automation execution
- `browser-tools.ts` — DOM interaction, element inspection, navigation
- `artifacts/` — Parser, persistence, server-detector
- `hooks/` — Server-side audit logger, cost tracker, file watcher, tool monitor

### Hooks (`web/src/hooks/`)

- `use-sse-stream.ts` — SSE streaming with TTFT tracking, `onUsage` callback
- `use-heartbeat.ts` — Subscribes to `minute:tick` IPC
- `use-cron.ts` — Cron evaluation on heartbeat
- `use-session-reset.ts` — Idle/daily session reset
- `use-electron.ts` — Electron IPC (file dialogs, auth)
- `use-voice-input.ts` — Local Whisper speech-to-text
- `use-at-suggestions.ts` — @-mention autocomplete
- `use-browser-agent.ts` — Browser automation coordination
- `use-file-drop.ts` — Drag-and-drop file handling
- `use-standing-orders.ts` — Automation template execution
- `use-auto-project.ts` — Auto-associate conversations with projects
- `use-conversations.ts` — Conversation list management
- `use-project-context.ts` — Project-scoped context injection
- `use-scratch-dir.ts` — Scratch directory lifecycle management

## External Integrations

- **OAuth connectors** provisioned to `~/.claude/.mcp.json` via `loadProvisionedMcpServers()` at request time
- **Web search** via the `web-search` MCP — opt-in, only mounted when `SEARXNG_INSTANCES` is set
- **Telemetry** via SigV4-signed analytics API (`ANALYTICS_API_URL`)
- **Auto-update** from generic provider URL in electron-builder config
- **Nango** (optional) for 700+ OAuth connector hub

## Environment Variables

Defined in `.env` (copy from `.env.example`):

- `ANTHROPIC_API_KEY` — Claude inference via the Anthropic API (BYOK; also settable per-user in Settings → API Access)
- `CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials — Alternative: Claude inference via Bedrock
- `NIB_COWORK_DEFAULT_MODEL` — Default model (`sonnet`)
- `ANALYTICS_API_URL` / `ANALYTICS_AWS_REGION` — ROI telemetry pipeline (opt-in; telemetry is off without it)
- `SEARXNG_INSTANCES` — searxng URL for web search (no default; feature off without it)
- OAuth credentials (GitHub, Slack, Atlassian, MS365, Google, Figma, Miro, Zoom) — see `.env.example`
- `NANGO_*` — Optional Nango connector hub

## Key Patterns

- **SSE streaming**: API routes yield chunks via `createSSEStream()`; client reads via `response.body.getReader()` in `use-sse-stream.ts`
- **Session controls**: Slash commands parsed into `SessionControls` (thinkLevel, verboseMode, modelOverride, agentName) passed to provider
- **Agent routing**: `route.ts` loads AGENTS.md, matches on triggers or `/agent` command, injects agent system prompt
- **Tool interception**: `canvas` tool → SSE event → canvas-store; `spawn_agent` → HTTP to `/api/subagent`; loop detection via sliding window
- **Cowork sidebar**: Tool calls categorized into Context (Read/Glob/Grep/Bash) and Artifacts (Write/Edit/NotebookEdit) by `categorizeToolCall()`. Search results from MCP searxng aggregated into `SearchResultsCard`. WebFetch URLs from search follow-ups are suppressed from Context.
- **Minute tick**: Electron main sends `minute:tick` IPC → preload exposes `onMinuteTick` → hooks subscribe for cron, heartbeat, session reset
- **Identity files**: `SOUL.md` (personality) + `USER.md` (user context) injected into system prompt
- **ROI tracking**: `done` SSE event with token/cost/duration → effort estimation via Haiku → conversation metrics

## Building

```bash
cd web && npm run dist          # macOS (DMG + ZIP, x64 + arm64)
cd web && npm run dist:win      # Windows (NSIS installer)
cd web && npm run dist:linux    # Linux
```

Output goes to `web/dist/`. The `outputFileTracingExcludes` in `next.config.ts` excludes `dist/`, `release/`, `temp/`, and `.next/cache/` from the standalone bundle to keep app size reasonable (~500MB).

## Releasing

Releases are triggered by pushing a version tag to origin:

```bash
# 1. Bump version in web/package.json
# 2. Commit the change
# 3. Tag and push
git tag v1.0.X && git push origin v1.0.X
```

The pipeline (`.github/workflows/release.yml`):
1. **GitHub Actions** builds macOS (DMG + ZIP, signed + notarized when Apple secrets are set) and Windows (NSIS installer) artifacts
2. Creates a **GitHub Release** with the artifacts attached — this is also the auto-update feed (electron-updater `github` provider)

### Optional GitHub secrets

`MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (macOS signing/notarization), `WIN_CERT_PFX_BASE64`, `WIN_CERT_PASSWORD` (Windows signing), `DOT_ENV` (bundled .env)

## Config Files

- `web/src/config/branding.ts` — Product name and branding constants (`APP_NAME`). Never hardcode the product name; import from here
