# Project State

## Current Position

Phase: 1 (Backend)
Plan: 4 (Server API Expansion)
Status: In progress
Last activity: 2026-03-12 - Completed 1-4 (Server API Expansion)

## Decisions

| # | Decision | Phase | Rationale |
|---|----------|-------|-----------|
| 1 | Six-surface Vite architecture | 0-1 | chat, cowork, code, browser, sidebar, tabbar as independent entry points |
| 2 | Node 20 LTS | 0-1 | Stable version compatible with Electron 39 |
| 3 | Chrome 130 build target | 0-1 | Matches Electron 39 Chromium |
| 4 | Application menu for shortcuts | 0-2 | Menu accelerators integrate with OS natively, appear in menu bar, don't conflict with other apps |
| 5 | Z-order: surfaces first, sidebar/tabbar on top | 0-2 | Ensures chrome views always render above surface panels |
| 6 | All views share preload-new.js | 0-2 | Unified API bridge; each surface gets same electronAPI interface |
| 7 | Three-tier merge (explicit > surface > default) | 1-3 | API callers can override surface defaults while surfaces provide sensible per-panel config |
| 8 | Graceful fallback on unknown surfaceId | 1-3 | Logs warning and uses defaults rather than throwing |
| 9 | Composite abort key surfaceId:chatId | 1-3 | Prevents collisions between concurrent surface queries |
| 10 | Bedrock env merged unconditionally when configured | 1-3 | If AWS credentials present, always route through Bedrock |
| 11 | Register /:surfaceId before /api/chat | 1-4 | Express matches routes in registration order; parameterized route must come first |
| 12 | Strip systemPrompt from surface configs API | 1-4 | Security: don't expose system prompts to client |
| 13 | Surface configs committed with server.js | 1-4 | Direct import dependencies; server.js would fail without them |

## Blockers/Concerns

None.

## Session Continuity

Last session: 2026-03-12T23:03Z
Stopped at: Completed 1-4 (Server API Expansion)
Resume file: None
