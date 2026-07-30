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

## CI runs on self-hosted runners, and that changes a few things

GitHub-hosted runners are **unavailable on this account** — every `ubuntu-latest`
job failed in ~9s with *"recent account payments have failed or your spending
limit needs to be increased"*. So CI is three **self-hosted** runners on the
Contabo box (`redacted-host`), registered at org level in the Default group with
visibility: all, labelled:

```
self-hosted, Linux, X64, contabo
```

Workflows target `runs-on: [self-hosted, linux]`. Use `contabo` instead of
`linux` only if runners are ever added elsewhere and a job must pin to this box.

**What still cannot run.** `release.yml`'s `build-mac` and `build-win` need macOS
and Windows, and the pool is Linux-only — so releases stay blocked until the
billing is settled or a matching runner joins. That is deliberate and noted in
the workflow, not an oversight.

### Three things about the box that bite

1. **It is shared and contended.** Three runners serve every repo in the org, and
   `rekall` alone can queue 17 jobs. The unit suite runs in ~14s locally and took
   **197s** there. `vitest.config.ts` therefore sets `testTimeout`/`hookTimeout`
   to 30s: the 5s default is a fast-laptop assumption, and five tests failed on
   it — the fast-check property suites and the SSE route test — with no bug
   involved. Do not tune a test to fit 5s; the timeout was the wrong number.
2. **There is no passwordless sudo.** Anything that shells out to `apt` fails
   with *"a password is required"*. `npx playwright install --with-deps` did
   exactly that, so CI installs the browser binary only
   (`npx playwright install chromium`) and Chromium's OS libraries are
   provisioned on the host once. If a new Playwright version wants new libs,
   install them on the box rather than adding `--with-deps` back.
3. **A C toolchain is present but was not originally.** `build-essential` is
   installed now; before that, any native dependency failed to build. That is
   how `node-pty` came to be an `optionalDependency` — see the note in
   `lib/code-workspace/pty-manager.js`. The lazy `require` and its catch are
   load-bearing, not defensive habit.

### What gates a push

`test` (typecheck → lint → unit → **build**) and `e2e` on every push and PR.
`mutation` runs weekly and on `workflow_dispatch` only — a slow check on every
push is a check people learn to skip.

The **build** step earns its place: `tsc --noEmit` and the whole unit suite pass
for a Next.js client/server boundary violation. A client component importing a
module that reaches `fs` fails only in `next build`. That shipped once —
`provider-manager.tsx` → `lib/models/credentials` → `app-paths` → `fs` — with
typecheck and 2777 tests green.

### Migrating another repo in the org

Change `runs-on: ubuntu-latest` (and `ubuntu-24.04`, `ubuntu-22.04`) to
`[self-hosted, linux]`. Leave alone: `macos-*`/`windows-*` (need those OSes),
`*-arm` (the pool is X64, so moving an arm job breaks the build it exists for),
`blacksmith-*` (third-party, not GitHub-billed, may still work), and
matrix-driven `runs-on` (the fix belongs in the matrix).

**Push over git/SSH, not the API.** `gh api` refuses to write under
`.github/workflows/` — *"refusing to allow an OAuth App to create or update
workflow … without `workflow` scope"* (and 404s elsewhere, which is GitHub
masking a 403). A plain `git push` is not subject to that scope check.

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

- `claude-provider.ts` — The provider (Claude Agent SDK). Injects MCP servers (connectors + optional `web-search` searxng + in-process `aime` server), handles tool interception (canvas, spawn_agent, loop detection), session controls. A multi-provider model registry is the first roadmap pillar.

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
