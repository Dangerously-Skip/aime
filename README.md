# Nib Cowork

An Electron desktop AI workspace powered by the Claude Agent SDK. Built with Next.js, React, and shadcn/ui.

## Features

- **Multi-surface workspace** — Chat, Cowork (agent), Code, and Browser surfaces
- **Real-time streaming** — SSE token-by-token responses
- **OAuth connectors** — GitHub, Slack, Jira, Confluence, Figma, Google Drive, and more via MCP
- **Tool visualization** — Context and Artifacts panels showing tool inputs/outputs
- **Agent routing** — AGENTS.md-based routing with model/tool overrides
- **Skills** — Extend Claude with custom `SKILL.md` capabilities
- **Memory** — Auto-extracted memories + daily logs + long-term MEMORY.md

## Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop | Electron.js |
| Frontend | Next.js + React + shadcn/ui |
| AI | Claude Agent SDK |
| Tools | MCP (OAuth connectors provisioned to `~/.claude/.mcp.json`) |
| Streaming | Server-Sent Events (SSE) |
| State | Zustand + persist |

## Quick Start

```bash
cd web && npm install
npm run electron:dev
```

Copy `.env.example` to `.env` and add your API keys.

## Configuration

### Required
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)

### OAuth Connectors (optional)
Set client credentials in `.env` to enable built-in OAuth flows for GitHub, Slack, Jira, Confluence, MS365, Google Drive, Figma, Miro, Zoom. See `.env.example` for all variables.

Connected apps are provisioned to `~/.claude/.mcp.json` and loaded automatically on each chat request.

## Project Structure

```
web/
├── electron/                  # Electron main + preload
├── src/
│   ├── app/api/               # Next.js API routes (chat SSE, connectors, settings)
│   ├── components/surfaces/   # Chat, Cowork, Code, Browser surfaces
│   ├── lib/connectors/        # OAuth flow, registry, provisioner
│   ├── stores/                # Zustand stores
│   └── hooks/                 # Custom React hooks
```

## Resources

- [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-agent-sdk)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Electron Docs](https://www.electronjs.org/docs)
