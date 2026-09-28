# Contributing to AIME

Thanks for helping. This page is the short version; `CLAUDE.md` has the
long-form architecture notes and the history behind the rules below.

## Setup

Node.js 22+ (`.nvmrc`), npm, git.

```bash
git clone https://github.com/Dangerously-Skip/aime.git
cd aime/web
npm install
npm run hooks:install      # recommended, see below
cp .env.example .env       # optional
npm run electron:dev
```

Running `next dev` without Electron? Set `AIME_API_TOKEN` in `web/.env` — the
local API refuses every request without one (see `src/lib/auth/local-token.ts`).

## Before you push

`npm run hooks:install` enables `.githooks/pre-push`, which runs
`npm run verify`: **typecheck → lint → unit tests → `next build`** (~70s). It is
opt-in on purpose; skip it for one push with `SKIP_VERIFY=1 git push`.

The build step is not optional busywork: a client component that imports a
module reaching `fs` passes `tsc` and every unit test and fails only in
`next build`.

## Pull requests

`main` is protected: changes land through a pull request, and the `test`
(typecheck, lint, unit, build) and `e2e` checks must pass. Force-pushes to
`main` are refused.

1. Branch from `main`, keep the PR focused on one change.
2. Explain **why** in the description and commit messages
   (conventional style: `fix(chat): …`, `feat(models): …`, `chore: …`).
3. Fill in the PR template's test checklist.

## Tests

Every change comes with tests. Put them next to the code (`foo.ts` →
`foo.test.ts`).

| Layer | Tool | Use it for |
|-------|------|------------|
| Unit | Vitest (`npm test`) | logic, stores, API route handlers, hooks/components (add `// @vitest-environment jsdom` and use Testing Library) |
| Property | fast-check | parsers, normalizers, security classifiers |
| E2E | Playwright (`npm run test:e2e`) | the happy path of user-facing features |
| Mutation | Stryker (`npm run test:mutation`) | weekly, on `lib/security/**` — do the assertions notice a broken guard? |

Conventions that matter here:

- **Bug fix → regression test first**, one that fails before the fix.
- **Don't mock the boundary the test exists to prove.** Mock the network and
  the SDK for wiring; drive the real guard (`canUseTool`, path containment,
  the auth proxy) when that guard is the point.
- **Security controls:** after implementing one, disable the enforcement, run
  the suite, and list the tests that fail in the commit message. If nothing
  fails, it is not enforced yet.
- **No `/proc` paths and no inode-keyed caches** in tests — both pass on macOS
  and fail in Linux CI. `CLAUDE.md` explains why.

Some tests guard the codebase itself and will tell you exactly what to fix:
`api-auth-coverage` (every API route is behind the auth proxy),
`send-route-coverage` and `single-setup-point` (models are chosen only in the
tier grid), `env-example` (every env var read is documented in
`web/.env.example`), `no-hardcoded-secrets`, `branding`.

## House rules

- Never hardcode the product name — import `APP_NAME` from
  `web/src/config/branding.ts`.
- Model selection goes through `resolveSendRoute`; don't add a second model picker.
- Persisted keys, paths and protocols from the Quarry era are renamed by
  reading the old name and writing the new one, never by a straight rename.
- Remove dead code instead of commenting it out.
- Icon-only buttons get an `aria-label`.

## Where things live

All app code is in `web/`:

| Path | What |
|------|------|
| `main-web.js`, `preload-web.js` | Electron main process and IPC bridge |
| `src/app/api/` | local API routes (auth-gated by `src/proxy.ts`) |
| `src/components/surfaces/` | Chat, Cowork, Code, Browser, Assistant |
| `src/components/settings/` | Settings, incl. providers, tier grid, security toggles |
| `src/stores/` | Zustand stores |
| `src/lib/providers/` | the Claude Agent SDK provider |
| `src/lib/models/` | provider presets, model scan, tier routing, credentials |
| `src/lib/security/` | tool-permission guards used by `canUseTool` |
| `src/lib/connectors/`, `src/lib/mcp/` | OAuth connectors and MCP servers |
| `e2e/` | Playwright specs |

## Security issues

Please don't open a public issue — see [SECURITY.md](SECURITY.md).
