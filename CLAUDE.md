# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quarry is an Electron desktop AI workspace powered by the Claude Agent SDK. Built with Next.js 16, React 19, and shadcn/ui in the `web/` directory. Five surfaces (Chat, Cowork, Code, Browser, Assistant) with real-time streaming via SSE, OAuth connectors exposed as MCP tools, agent routing, standing orders/automation, memory extraction, ROI telemetry, and document processing (PDF, DOCX, XLSX, PPTX, audio, video).

## Development Commands

```bash
cd web && npm run electron:dev   # Start Next.js dev server + Electron
cd web && npm run typecheck      # Run tsc --noEmit (run before shipping)
cd web && npm run dist           # Build macOS app (next build + electron-builder)
```

No test suite or linter is configured. `npm run typecheck` is the only type-safety gate — run it before commits and ships.

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

- `claude-provider.ts` — Main provider. Injects MCP servers (connectors + `nib-web-search` searxng + `quarry`), handles tool interception (canvas, spawn_agent, loop detection), session controls
- `gateway-provider.ts` — API gateway routing
- `opencode-provider.ts` — OpenCode SDK integration

### Key Libraries (`web/src/lib/`)

- `slash-commands.ts` — `/think`, `/verbose`, `/reasoning`, `/model`, `/agent`, `/help` — parses into `SessionControls`
- `agents-parser.ts` — Loads `AGENTS.md` from `~/.claude/` + cwd, matches on triggers or `sessionControls.agentName`
- `a2ui/` — Anthropic A2UI canvas type system (`types.ts`) + renderer (`renderer.tsx`)
- `telemetry/` — `roi.ts`, `analytics-client.ts` (SigV4), `event-buffer.ts` (JSONL)
- `memory/` — `extractor.ts`, `retriever.ts`, `summarizer.ts`
- `connectors/` — OAuth flow, credential storage, provisioner, registry (GitHub, Slack, Jira, Confluence, Figma, Google Drive, SharePoint, Outlook, Miro, Zoom, Buildkite, SumoLogic, AWS)
- `extractors/` — PDF, DOCX, XLSX, PPTX, audio, video content extraction
- `surfaces/` — Per-surface config (allowed tools, system prompts). Cowork config has web search prompt directing to `nib-web-search` MCP
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
- **Web search** via `nib-web-search` MCP (searxng at `SEARXNG_INSTANCES` env var)
- **Telemetry** via SigV4-signed analytics API (`ANALYTICS_API_URL`)
- **Auto-update** from generic provider URL in electron-builder config
- **Nango** (optional) for 700+ OAuth connector hub

## Environment Variables

Defined in `.env` (copy from `.env.example`):

- `CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials — Required for Claude inference via Bedrock
- `ANTHROPIC_API_KEY` — Alternative to Bedrock (direct API)
- `NIB_COWORK_DEFAULT_MODEL` — Default model (`sonnet`)
- `ANALYTICS_API_URL` / `ANALYTICS_AWS_REGION` — ROI telemetry pipeline
- `SEARXNG_INSTANCES` — Custom searxng URL (defaults to internal nib instance)
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
1. **GitHub Actions** builds macOS (DMG + ZIP, signed + notarized) and Windows (NSIS installer) artifacts
2. Creates a **GitHub Release** with the artifacts attached
3. Triggers **Buildkite `promote-release`** pipeline via API — downloads artifacts, bundles with landing page, deploys to internal site via SAMOA (`RQP::StaticSite`)
4. **Strips the CloudFront WAF** (`:unlock: Remove WAF from CloudFront` step)

Internal download page: `quarry.internal.invalid` (VPN required). Existing installs auto-update.

### ⚠️ WAF bypass constraint — don't remove

SAMOA attaches a Cloudflare-IP-whitelist WAF to every CloudFront distribution it
provisions. This site is **VPN-only internal**, not routed through Cloudflare, so
the WAF blocks every legitimate nib VPN user with 403s.

The final Buildkite step (`.buildkite/promote-release.yml:167`) detaches the
WebACL from the distribution after each deploy. It is `soft_fail: true`, so if
this step errors the overall pipeline still goes green — **and the download site
silently becomes inaccessible to VPN users until someone notices**.

After pushing a release tag, watch the Buildkite pipeline and confirm the
`:unlock: Remove WAF from CloudFront` step logs `WAF removed successfully`
(or `No WAF attached — nothing to do` if SAMOA's defaults have shifted). If it
fails, re-run that step manually or hand-strip the WebACL via `aws cloudfront
update-distribution` using the `deployer` role in account `384553929753`.

### Release infrastructure

| File | Purpose |
|------|---------|
| `.github/workflows/release.yml` | GitHub Actions: build + notarize + release + trigger Buildkite |
| `.buildkite/pipeline.yml` | Buildkite: SAMOA deploy |
| `.buildkite/promote-release.yml` | Buildkite: download from GitHub Release, bundle, deploy |
| `infrastructure/releases/sam_template.yaml` | SAM template (`RQP::StaticSite`) |
| `infrastructure/releases/nginx.conf` | Nginx config for release site |
| `infrastructure/releases/html/` | Landing page for internal download site |

### Required GitHub secrets

`MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `DOT_ENV`, `TEAMS_JSON`, `BUILDKITE_API_TOKEN`

## Config Files

- `web/src/config/teams.json` — Team definitions (injected from `TEAMS_JSON` secret in CI, use `teams.example.json` locally)
- `web/src/config/teams.ts` — TypeScript interface for team config
