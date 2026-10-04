# AIME — app source

Everything that runs lives here: the Electron shell (`main-web.js`,
`preload-web.js`), the Next.js app (`src/`), bundled MCP servers
(`mcp-servers/`) and dev scripts (`scripts/`).

Project overview, setup and model configuration: [../README.md](../README.md).
How to contribute: [../CONTRIBUTING.md](../CONTRIBUTING.md).

```bash
npm install
cp .env.example .env     # optional
npm run electron:dev     # Next.js dev server + Electron (mints AIME_API_TOKEN)

npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm test                 # Vitest unit suite
npm run test:e2e         # Playwright (boots next dev on :3100)
npm run verify           # typecheck + lint + unit + next build (the pre-push gate)
npm run dist             # desktop build (macOS); dist:win, dist:linux
```
