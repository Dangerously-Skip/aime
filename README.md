# Quarry

A desktop AI workspace for nib teams. Select your team, start working.

![Quarry](docs/hero.png)

## Download

| Platform | Download |
|----------|----------|
| Mac (Apple Silicon) | [Quarry-arm64.dmg](https://github.com/redacted-org/quarry/releases/latest) |
| Mac (Intel) | [Quarry.dmg](https://github.com/redacted-org/quarry/releases/latest) |
| Windows | [Quarry-Setup.exe](https://github.com/redacted-org/quarry/releases/latest) |

Auto-updates are built in. Once installed, new versions are downloaded and applied automatically.

## What it does

Quarry gives every nib team member an AI coding assistant that runs locally on their machine. It connects to Claude via your team's API key (configured automatically when you select your team during onboarding) or via AWS Bedrock.

### Surfaces

- **Chat** -- conversational AI with file attachments, web search, and model selection
- **Cowork** -- full agent workspace with folder picker, tool visualization (Context + Artifacts + Search Results panels), project management, and plan sheets
- **Code** -- code-focused surface with artifact management and dev server preview
- **Browser** -- built-in browser for research, testing, and DOM inspection
- **Assistant** -- standing orders, automation templates, and scheduled agent tasks

### Connectors

Connect your work apps via OAuth (one-click setup during onboarding or in Customize):

- GitHub (repos, PRs, issues)
- Slack (channels, messages)
- Jira (projects, tickets, boards)
- Confluence (spaces, pages, docs)
- Figma (design files)
- Google Drive, SharePoint, Outlook, Miro, Zoom, Buildkite, SumoLogic

Connected apps are exposed to Claude as MCP tools, allowing it to read issues, post messages, review PRs, and more. Optionally use [Nango](https://www.nango.dev/) as a connector hub for 700+ additional services.

### Document processing

Attach files directly to any conversation. Documents are extracted server-side before reaching the model:

| Format | Extensions | How it works |
|--------|-----------|--------------|
| PDF | `.pdf` | Page-by-page text extraction via pdfjs-dist |
| Word | `.docx` | Text extraction via mammoth |
| Excel | `.xlsx`, `.xls` | Sheets converted to markdown tables via SheetJS |
| PowerPoint | `.pptx` | Slide text + notes extracted via jszip |
| Audio | `.mp3`, `.wav`, `.m4a`, `.ogg` | Whisper transcription (@huggingface/transformers) |
| Video | `.mp4`, `.mov`, `.webm`, `.avi` | ffmpeg audio extraction then Whisper transcription |
| Images | `image/*` | Passed through as vision input |
| Text/Code | `.txt`, `.md`, `.csv`, `.json`, etc. | Inlined directly |

**Cowork/Code surfaces**: extracted text is saved to `~/.quarry/scratch/{chatId}/documents/` and the agent uses Read/Grep tools to navigate it. No size truncation.

**Chat surface**: first ~30k characters are inlined into the prompt with `<document>` tags.

**Large files** (>10MB): uploaded via `POST /api/upload` as multipart instead of base64 in the JSON body.

**Excel tools**: the agent can read, create, and edit Excel files using ExcelRead, ExcelWrite, and ExcelEdit MCP tools (available on Cowork and Code surfaces).

### Agent routing

Define custom agents in `AGENTS.md` files (`~/.claude/AGENTS.md` or in your project root). Each agent specifies triggers, a system prompt, and a tool profile. Invoke via `/agent <name>` or let Quarry auto-match based on message content.

### Automation

- **Standing orders** -- persistent instructions that execute on triggers (cron schedules, webhooks, or manual)
- **Cron jobs** -- scheduled agent tasks evaluated on a minute-tick heartbeat
- **Webhooks** -- trigger agent runs via HTTP POST to `/api/webhooks/[token]`
- **Subagents** -- spawn child agent tasks via `/api/subagent` (single or batch)

### Memory & Identity

- **Memory** -- automatic context extraction across conversations, daily digest generation
- **Identity files** -- `SOUL.md` (personality) and `USER.md` (user context) injected into every system prompt
- **Slash commands** -- `/think`, `/verbose`, `/reasoning`, `/model`, `/agent`, `/help`

### Telemetry & ROI

- Per-conversation token usage, cost, and duration tracking
- Effort estimation via Claude Haiku (task type, complexity, estimated human hours)
- ROI badges on conversations and projects (time multiplier, dollars saved)
- Analytics pipeline via SigV4-signed API for org-level adoption/ROI reporting

### Other features

- **Model selection** -- switch between Claude Opus, Sonnet, and Haiku
- **Voice input** -- local speech-to-text via Whisper
- **Web search** -- MCP-based searxng integration (no built-in WebSearch dependency)
- **A2UI canvas** -- interactive UI components rendered in-conversation
- **Project management** -- organize work across multiple codebases with per-project artifacts
- **Conversation history** -- searchable chat history with daily grouping and user ratings
- **System diagnostics** -- `/api/doctor` health checks and Customize > Doctor panel

## Development

```bash
cd web
cp ../.env.example .env    # Add credentials (see below)
npm install
npm run electron:dev
```

No test suite or linter is configured.

### Environment variables

Copy `.env.example` to `web/.env` and fill in credentials:

| Variable | Required | Purpose |
|----------|----------|---------|
| `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_*` | Yes (or API key) | Claude inference via AWS Bedrock |
| `ANTHROPIC_API_KEY` | Alternative | Direct Anthropic API access |
| `NIB_COWORK_DEFAULT_MODEL` | No | Default model (`sonnet`) |
| `ANALYTICS_API_URL` | No | ROI telemetry ingest endpoint |
| `SEARXNG_INSTANCES` | No | Custom searxng URL (defaults to internal nib instance) |
| `GITHUB_CLIENT_ID/SECRET` | No | GitHub OAuth connector |
| `SLACK_CLIENT_ID/SECRET` | No | Slack OAuth connector |
| `ATLASSIAN_CLIENT_ID/SECRET` | No | Jira + Confluence connector |
| `NANGO_*` | No | Nango connector hub (700+ services) |

See `.env.example` for the full list including MS365, Google, Figma, Miro, and Zoom.

### Architecture

Electron + Next.js app. All source code is in `web/`.

```
web/
  main-web.js                     # Electron main process (windows, IPC, auto-updater, minute-tick)
  preload-web.js                  # IPC bridge (file dialogs, auth, notifications, updates)
  src/
    app/api/                      # Next.js API routes
      chat/[surfaceId]/           #   SSE streaming with agent routing + tool interception
      connectors/                 #   OAuth flow + provisioning
      customize/                  #   Connectors, plugins, skills CRUD
      telemetry/                  #   Usage events + effort estimation
      identity/                   #   SOUL.md + USER.md editors
      memory/                     #   Daily memory extraction
      cron/, webhooks/            #   Automation triggers
      subagent/                   #   Child agent spawning
    components/
      surfaces/                   # Chat, Cowork, Code, Browser, Assistant
      shared/                     # Message list, input, tool cards, canvas, ROI badge
      settings/                   # Settings dialog + sections (profile, appearance, identity, etc.)
      customize/                  # Connector browser, agent panel, doctor, automation
      layout/                     # Sidebar, tabbar, app shell, surface router
      projects/                   # Project grid, detail, create, settings
      onboarding/                 # Setup wizard (team, connectors)
    stores/                       # 16 Zustand stores (app, chat, cowork, code, browser, assistant,
                                  #   conversation, settings, project, connector, canvas, cron,
                                  #   heartbeat, memory, context-bus, reminder)
    hooks/                        # React hooks (SSE stream, electron, voice, heartbeat, cron,
                                  #   session-reset, browser-agent, file-drop, standing-orders,
                                  #   at-suggestions, project-context)
    lib/
      providers/                  # AI providers (Claude, Gateway, OpenCode)
      connectors/                 # OAuth registry + provisioner (13 services)
      surfaces/                   # Per-surface config (allowed tools, system prompts)
      telemetry/                  # ROI calc, analytics client, event buffer
      memory/                     # Extraction, retrieval, summarization
      extractors/                 # PDF, DOCX, XLSX, PPTX, audio, video
      a2ui/                       # Anthropic A2UI canvas types + renderer
      artifacts/                  # Parser, persistence, server-detector
      hooks/                      # Server-side audit logger, cost tracker, tool monitor
      slash-commands.ts           # Slash command parser -> SessionControls
      agents-parser.ts            # AGENTS.md loader + matcher
      browser-tools.ts            # DOM interaction, navigation
      standing-order-engine.ts    # Automation execution
```

### Building

```bash
cd web
npm run dist           # macOS (DMG + ZIP, x64 + arm64, signed + notarized)
npm run dist:win       # Windows (NSIS installer)
npm run dist:linux     # Linux
```

Output goes to `web/dist/`. Releases are built via GitHub Actions on tag push:

```bash
git tag v1.0.28 && git push origin v1.0.28
```

The build pipeline is defined in `.github/workflows/release.yml`.

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 41 |
| UI | Next.js 16 + React 19 + shadcn/ui |
| AI | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) |
| Connectors | MCP (Model Context Protocol) via OAuth + Nango |
| Web Search | SearXNG via MCP (`@jharding_npm/mcp-server-searxng`) |
| Streaming | Server-Sent Events |
| State | Zustand (16 stores, persisted) |
| Documents | pdfjs-dist, mammoth, SheetJS, jszip, Whisper |
| Telemetry | SigV4-signed analytics API + JSONL buffer |
| Build | electron-builder (DMG/NSIS/Linux) |
