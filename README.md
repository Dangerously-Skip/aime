# AIME

An open-source desktop AI workspace, powered by the Claude Agent SDK.

AIME gives you a local-first AI workspace with five surfaces — Chat, Cowork,
Code, Browser, and Assistant — backed by real agent tooling: filesystem
access with full visibility, OAuth connectors exposed as MCP tools, standing
orders and scheduled automation, document generation, and long-term memory.

> **Status:** AIME is the open-source continuation of an internal tool
> (previously "Quarry"). The rename is largely done; a few internal
> identifiers keep their old names on purpose so existing installs migrate
> their data automatically. Design decisions are recorded in commit messages
> and in comments at the point of use — the code explains its own history
> where it matters.

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

Requirements: **Node.js 22 or newer** (see `.nvmrc`), npm, and git. macOS is the
primary platform; Windows and Linux builds exist.

```bash
git clone https://github.com/Dangerously-Skip/aime.git
cd aime/web
npm install
npm run hooks:install         # optional: pre-push runs typecheck, lint, tests, build
cp .env.example .env          # optional: every variable in it is optional
npm run electron:dev          # Next.js dev server + Electron
```

On first launch, onboarding asks for a model provider. That is the only
configuration you need; keys are stored encrypted on your machine
(`~/.aime/credentials.enc`, with the key held in the OS keychain via Electron).

`npm run electron:dev` mints the local API token for you. If you run
`next dev` on its own (without Electron), set `AIME_API_TOKEN` in `web/.env`
first — every `/api` route refuses requests (503) without one, by design.

### Model access

Providers are added by API key in onboarding or **Settings → API Access**:

| Provider | How it runs |
|----------|-------------|
| Anthropic, AWS Bedrock, Google Vertex (Claude) | natively through the Claude Agent SDK |
| OpenRouter | its Anthropic-compatible endpoint, through the Agent SDK |
| OpenAI, Google Gemini, Groq, Azure OpenAI | through a local OpenAI-compatible shim |
| Local (Ollama / LM Studio), any OpenAI-compatible endpoint | same shim, your base URL |
| Fal | image, 3D and voice capabilities (not chat) |

Model lists are scanned from each provider's API where it offers one (Bedrock,
Vertex and Azure deployments are entered by hand). Which model does what is set
in one place — the **tier grid** (also under API Access): a capability (chat,
code, image, embedding, …) × tier (cheap → premium) table. Every surface resolves
its model through that grid, so switching providers never means re-picking
models surface by surface.

Environment-only setups also work: `ANTHROPIC_API_KEY`, or AWS Bedrock via
`AWS_REGION` plus AWS credentials. See `web/.env.example` for every variable.

### Web search (optional)

Choose a search provider in **Settings → Web Search**: OpenRouter, Tavily, Brave,
or a self-hosted [SearXNG](https://docs.searxng.org/) instance. With nothing
chosen, AIME falls back to your inference credential when it can also search.

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

Connect work apps via OAuth from Customize — GitHub, Slack, Jira and Confluence,
Figma, Google Workspace, Microsoft 365 (Outlook, OneDrive/SharePoint), Miro,
Zoom, AWS, and more — or add any remote MCP server by URL. Connected apps are
exposed to the agent as MCP tools.

## Development

```bash
cd web
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # unit tests (Vitest)
npm run test:e2e    # Playwright smoke tests
npm run verify      # all of the above except e2e, plus next build
npm run dist        # build the desktop app (macOS)
```

CI runs typecheck, lint, unit tests, build, and E2E on every push and pull
request, and `main` only accepts changes through a pull request with those
checks green. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and
`CLAUDE.md` for architecture notes.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability and what the
Settings → Security controls enforce.

## License

See [LICENSE](LICENSE).
