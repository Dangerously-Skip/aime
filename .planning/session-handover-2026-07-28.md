# Session handover — 2026-07-28

Everything below is on `master` (`99b370b`). Working tree clean; `tsc --noEmit`
clean; 158 test files / 2335 tests; 0 lint errors.

## Read this first: two workflow facts that cost hours today

1. **Server-side changes need a full app restart, not ⌘R.** ⌘R reloads only the
   renderer. Anything under `web/src/lib/**` or `web/src/app/api/**` lives in the
   Next server process, which keeps its old module graph. Three rounds of "the
   fix didn't work" were the user testing a server started two hours before the
   fixes existed. **A byte-identical error after a real code change means stale
   code, not a wrong diagnosis.**

2. **Don't run Playwright/Electron probes against the user's real profile.** They
   share `userData`, so they complete/clear onboarding for real. Use
   `--user-data-dir=<temp>` (see `web/e2e/single-instance.spec.ts`). Also: only
   one instance can run — the single-instance lock is deliberate.

## What shipped today

A max-effort review found 29 confirmed defects; all fixed across `REVIEW-1`–`4`.
Then a long live-debugging session against a real OpenRouter key found six more:

| Commit | Bug |
|---|---|
| `54dac67` | **Dev picked a random port each launch.** localStorage is origin-scoped, so every restart was a blank profile. `main-web.js` had pinned 19532 for packaged builds with the comment "so localStorage persists across launches" — dev never got the same treatment. Dev now pins 19533. |
| `a6fad7f` | **Renderer froze at 100% CPU.** `model-selector.tsx` rehydrated a global store from an effect keyed on a function prop, so every parent render restarted it. Fixed by adding `provider-store` to `StoreHydration` — it was the only persisted store missing from it. |
| `d017218` | Doubled `/v1` on the SDK base URL — why every `anthropic/*` model failed while Kimi worked. |
| `f5926af` + `f1555c4` | Tool schemas: union `type` arrays and `additionalProperties` that Google's converter cannot represent, so it dropped properties and `required` then dangled. |
| `bfd97e3` | Per-model transport, so an aggregator's non-native models use the openai-compat shim. |
| `b7daa99` | BYOK-only users were prompted to log in to Anthropic — the default route ignored user providers. |
| `f04a1cb` | Turn ended when the socket closed, not when the content did — Stop button lingered after the answer. |

Both provider paths (native + shim) are now exercised end-to-end. Confirmed
working by the user: Kimi K2.7, Kimi K3, DeepSeek V4, Gemini 3.6 Flash.

## Open items, roughly prioritised

All of 1–5, 7 and 8 are done — see "Closed since". Two remain.

6. **`thumbs-up-robot.png`** on the onboarding summary is still a raster icon,
   against the user's "outline icons except brand marks" rule. Undecided whether
   the mascot is deliberate. (Explicitly deferred by the user on 2026-07-29.)
9. **`blockDangerousCommands` and `restrictToProjectFolder` are prompt-only.**
   Found while fixing the `allowedTools` hole below, and the same shape of
   problem: both settings only append a sentence asking the model nicely, so
   they read as guards and are not. Unlike the tool switches this cannot be
   fixed by wiring — it needs command-string and path inspection in
   `canUseTool`, and a false positive there breaks legitimate work. A design
   call, not a wiring fix. `lib/path-containment.ts` already exists and is used
   by the document/skill writers, so the containment half has a foundation.

## Closed since

- **8** — `master` → `main` renamed; CI now triggers on `main` (`5d09995`).
- **1 + 5** (`f6437b7`) — built-in reachability is now the union of the user's
  key, the server's `ANTHROPIC_API_KEY`, and Bedrock. `/api/models` reports the
  latter two as booleans; `useBuiltinAccess` joins them. The picker drops the
  "Built-in (Claude)" group when none apply, and the trigger falls back to the
  tier `defaultRoute` resolves — the same function the send path calls, extracted
  from `resolveSendRoute` so label and route cannot drift. Optimistic until the
  server answers, so an env-key install doesn't flicker on every boot.
- **2** (`f6437b7`) — onboarding reuses the provider id already configured for a
  preset instead of minting a uuid per press. Existing strays are *reported* in
  Settings → API Access with a delete button, not swept: they're secrets, and an
  automatic sweep loses every key the moment provider-store hydration hiccups —
  precisely what the dev-port bug did to localStorage.
- **7** (`1305b1e`) — the gate is exercised end to end across BOTH requests now
  (`api/chat/approval-gate.integration.test.ts`). The pieces were each covered;
  the seam between them — canUseTool parks a promise, a *separate* POST to
  /api/chat/answer settles it — was not, and the seam is the mechanism. Nothing
  on that path is mocked but the SDK. Draining the stream with `res.text()`
  deadlocks, which is the feature. `QuestionCard` also had no test at all.
  Both mutation-verified, not just green.
- **3** (`183d487`) — cowork and code now handle the `widget_create` chunk;
  only chat and assistant ever did (`9087d8a` wired exactly those), and the
  switches have no `default:`, so it vanished silently. Separately, the flush
  emitting widget/cron/standing-order chunks sat after the stream loop inside
  `try`, which the abort path never reaches — Stop or the 90s watchdog lost the
  widget on chat too. Now `drainPending()`, called on both paths.
- **4** (`183d487`) — WebFetch was reachable all along; nothing filters it. The
  prompt was the bug. Search is opt-in on `SEARXNG_INSTANCES` (set nowhere, not
  even in `.env.example`), yet cowork/code told the model unconditionally that
  `web_search` was its only search tool, banned the built-in WebSearch (already
  in `disallowedTools`), banned curl, and framed WebFetch as a follow-up to
  search results that could never arrive. Hence the curl flailing.
  `webSearchPrompt()` now picks its text from the same env var that decides the
  mounting, in the same process.
- **NEW, found on the way** (`0129fbe`) — **the tool restrictions did not
  restrict.** "Disable Bash tool", the tool profiles, and an agent's tool list
  all worked by filtering `allowedTools`, which is the SDK's *auto-approve*
  list, not the set of mounted tools. With `bypassPermissions` and a catch-all
  allow in `canUseTool`, they changed nothing: probed it, `canUseTool('Bash',
  {command: 'rm -rf ~/x'})` returned `allow`. Each step now records what it
  removed, and the provider enforces that set as `disallowedTools` *and* in
  `canUseTool`. Note the two traps avoided, both documented in code: the
  complement of `allowedTools` is not a deny list (those lists were never
  exhaustive), and a profile must not withhold the app's own plumbing
  (`PLUMBING_TOOLS`).

## Things the user asked for that are NOT derivable from the code

- Call the product **AIME**; never hardcode the name (`web/src/config/branding.ts`).
- The org/teams concept is gone — it lives in a separate repo now.
- Any picture/emoji icon should be an outline icon, **except brand marks**
  (connector logos stay).

## Known environment quirk

Image attachments have been unreachable from the agent filesystem all session
(`.context/attachments/...` never resolved), so screenshots could not be read.
Server logs at `/tmp/aime-*.log` proved more useful anyway — `[CHAT] Model:` and
`[CHAT] Provider config:` lines identify the exact route taken.
