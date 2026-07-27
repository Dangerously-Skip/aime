# AIME

An open-source desktop AI workspace, powered by the Claude Agent SDK.

AIME gives you a local-first AI workspace with five surfaces — Chat, Cowork,
Code, Browser, and Assistant — backed by real agent tooling: filesystem
access with full visibility, OAuth connectors exposed as MCP tools, standing
orders and scheduled automation, document generation, and long-term memory.

> **Status:** AIME is the open-source continuation of an internal tool
> (previously "Quarry"). The rename and de-internalization are in progress —
> see `.planning/aime-roadmap.md` for the roadmap and decision records.
> Existing installs migrate their data automatically.

## Surfaces

- **Chat** — conversational AI with file attachments, web search, and model selection
- **Cowork** — deep work with the agent on a real folder: tool transparency
  (Context + Artifacts panels), document deliverables (PDF/PPTX/XLSX), plan
  sheets, and a canvas panel for diagrams/boards/dashboards
- **Code** — developer workspace with IDE mode: file tree, editor, terminals, diffs
- **Browser** — built-in browser the agent can drive (observe–think–act)
- **Assistant** — standing orders, automation templates, and scheduled tasks
  that run without you

## Getting started (from source)

```bash
git clone https://github.com/Dangerously-Skip/aime.git
cd aime/web
npm install
cp .env.example .env          # add your model credentials (see below)
npm run electron:dev          # Next.js dev server + Electron
```

### Model access

AIME talks to Claude via the Claude Agent SDK. Configure one of:

- **Anthropic API (BYOK)** — set `ANTHROPIC_API_KEY` in `.env`
- **AWS Bedrock** — set `CLAUDE_CODE_USE_BEDROCK=1` plus standard AWS
  credentials (`AWS_REGION`, `AWS_PROFILE` or access keys)

A full multi-provider model registry (local models, OpenRouter, Vertex,
capability/tier routing) is the first major roadmap pillar.

### Web search (optional)

Web search uses a [SearXNG](https://docs.searxng.org/) instance via MCP.
Set `SEARXNG_INSTANCES=https://your-searxng-host` in `.env` to enable it.

## Documents

Attach files to any conversation — extraction happens locally before
anything reaches the model:

| Format | How |
|--------|-----|
| PDF | pdfjs-dist text extraction |
| Word (.docx) | mammoth |
| Excel (.xlsx/.xls) | SheetJS → markdown tables (plus ExcelRead/Write/Edit tools) |
| PowerPoint (.pptx) | jszip slide text + notes |
| Audio / Video | local Whisper transcription (ffmpeg for video) |
| Images | vision input |

## Connectors

Connect work apps via OAuth from Customize — GitHub, Slack, Jira, Confluence,
Figma, Google Drive, SharePoint, Outlook, Miro, Zoom, and more. Connected
apps are exposed to the agent as MCP tools. Optionally use
[Nango](https://www.nango.dev/) as a hub for 700+ additional services.

## Development

```bash
cd web
npm run typecheck   # tsc --noEmit
npm test            # unit tests (Vitest)
npm run test:e2e    # Playwright smoke tests
npm run dist        # build the desktop app (macOS)
```

CI runs typecheck, unit, and E2E on every push/PR. See `CLAUDE.md` for
architecture notes.

## License

See [LICENSE](LICENSE).
