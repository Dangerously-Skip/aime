# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nib Cowork is an Electron desktop chat application powered by the Claude Agent SDK. Built with Next.js, React, and shadcn/ui in the `web/` directory. Supports multiple AI providers (Claude, Opencode) with real-time streaming responses via SSE. OAuth connectors (GitHub, Slack, Jira, etc.) are provisioned via `~/.claude/.mcp.json` and injected into the Claude Agent SDK at request time.

## Development Commands

```bash
# Start the Next.js dev server + Electron
cd web && npm run electron:dev
```

No test suite or linter is configured.

## Architecture

**Next.js + Electron architecture** (all code in `web/`):

1. **Electron Main** (`web/electron/main.mjs`) — Window lifecycle, context isolation
2. **Electron Preload** (`web/electron/preload.mjs`) — IPC bridge via `contextBridge`
3. **Next.js App** (`web/src/`) — React UI with shadcn/ui components, Zustand stores
4. **API Routes** (`web/src/app/api/`) — Next.js route handlers for chat SSE, providers, settings

**Surfaces** (`web/src/components/surfaces/`):
- `chat/` — Conversational chat with attachments, web search
- `cowork/` — Agent workspace with folder picker, Context + Artifacts sidebar panels
- `code/` — Code-focused surface
- `browser/` — Browser surface

**Stores** (`web/src/stores/`):
- `chat-store.ts` — Chat surface state (messages, model, streaming)
- `cowork-store.ts` — Cowork surface state (messages, model, contextFiles, artifactFiles)
- `conversation-store.ts` — Conversation list management
- `settings-store.ts` — User preferences
- `project-store.ts` — Project management
- `app-store.ts` — Global app state (active surface, navigation)

**API Endpoints:** `POST /api/chat/[surfaceId]` (SSE streaming), `POST /api/abort`, `GET /api/providers`, `GET /api/health`, `GET /api/models`

**External integrations:**
- OAuth connectors (GitHub, Slack, Jira, Confluence, Figma, etc.) provisioned to `~/.claude/.mcp.json` and loaded at request time via `loadProvisionedMcpServers()`
- Connector registry: `web/src/lib/connectors/registry.ts` — maps connector IDs to MCP transport configs
- OAuth flow: `web/src/lib/connectors/oauth.ts` → `/api/connectors/oauth/token` → `provisioner.ts` → `.mcp.json`

## Environment Variables

Defined in `.env` (copy from `.env.example`):
- `ANTHROPIC_API_KEY` — Required for Claude provider (starts with `sk-ant-`)
- OAuth connector credentials (GitHub, Slack, Atlassian, MS365, Google, Figma, Miro, Zoom) — see `.env.example`

## Key Patterns

- **SSE streaming**: API routes yield chunks; client reads via `response.body.getReader()`
- **Session management**: Per-provider session tracking for conversation continuity
- **Centered input pattern**: Empty state shows centered greeting + inline input card; active state shows header + messages + bottom input
- **Cowork sidebar**: Tool calls categorized into Context (Read/Glob/Grep/WebSearch/WebFetch/Bash) and Artifacts (Write/Edit/NotebookEdit) panels by tool name
