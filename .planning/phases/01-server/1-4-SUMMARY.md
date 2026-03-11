# Phase 1 Plan 4: Server API Expansion Summary

Surface-routed Express endpoints with model/surface discovery APIs and Bedrock status reporting.

## Changes Made

### Task 1: Add POST /api/chat/:surfaceId route
- Registered surface-routed endpoint BEFORE legacy `/api/chat` to avoid Express route shadowing
- Validates surfaceId against `getAvailableSurfaces()` (chat, cowork, code, browser)
- Passes surfaceId to `provider.query()` along with surface-specific config (allowedTools, model, maxTurns)
- Uses surface config defaults for model and maxTurns when not overridden by request
- Full SSE streaming with heartbeat, Composio session management (same pattern as legacy endpoint)

### Task 2: Add GET /api/surfaces endpoint
- Returns all available surface names and their configs
- Strips `systemPrompt` from configs before sending to client (security measure)
- Uses destructuring to cleanly remove systemPrompt from each config object

### Task 3: Add GET /api/models endpoint
- Returns static model list: Opus 4.6, Sonnet 4.6, Haiku 4.5
- Returns default model (sonnet) and Bedrock configuration status via `isBedrockConfigured()`

### Task 4: Update POST /api/abort
- Accepts optional `surfaceId` in request body alongside existing `chatId`
- Conditionally passes surfaceId to `provider.abort()` only when present (backwards compatible)
- Updated logging to include surface context

### Task 5: Update startup logging
- Logs all endpoint URLs including new surface-routed and model/surfaces endpoints
- Logs available surfaces list
- Logs Bedrock configuration status

## Dependencies Added

- `server/surfaces/index.js` - Surface registry with `getAvailableSurfaces()` and `getSurfaceConfig()`
- `server/surfaces/chat-config.js` - Chat surface: WebSearch/WebFetch, sonnet, 20 turns, $1 budget
- `server/surfaces/cowork-config.js` - Cowork surface: full tool suite, opus, 100 turns, $5 budget
- `server/surfaces/code-config.js` - Code surface: full dev tools, sonnet, 200 turns, $10 budget
- `server/surfaces/browser-config.js` - Browser surface: Playwright MCP, sonnet, 30 turns, $2 budget
- `server/bedrock-env.js` - AWS Bedrock env helpers, model mapping, `isBedrockConfigured()`

## Backwards Compatibility

All existing endpoints remain fully functional:
- `POST /api/chat` - unchanged, still works without surfaceId
- `POST /api/abort` - surfaceId is optional, old clients work without it
- `GET /api/providers` - unchanged
- `GET /api/health` - unchanged

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Register /:surfaceId before /api/chat | Express matches routes in registration order; parameterized route must come first |
| 2 | Strip systemPrompt via destructuring | Clean, no mutation of original config objects |
| 3 | Surface configs committed alongside server.js | They're direct import dependencies; server.js would fail without them |

## Commits

| Hash | Message |
|------|---------|
| 3faa0c4 | feat(1-4): expand server API with surface-routed endpoints |

## Key Files

### Created
- `server/surfaces/index.js`
- `server/surfaces/chat-config.js`
- `server/surfaces/cowork-config.js`
- `server/surfaces/code-config.js`
- `server/surfaces/browser-config.js`
- `server/bedrock-env.js`

### Modified
- `server/server.js`

## Duration

~2 minutes (2026-03-11T23:01:09Z to 2026-03-11T23:03:05Z)
