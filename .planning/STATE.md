# Project State

## Current Position

Phase: 1 (Backend)
Plan: 3 (Multi-Surface Provider Refactor)
Status: In progress
Last activity: 2026-03-12 - Completed 1-3 (Multi-Surface Provider Refactor)

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

## Blockers/Concerns

None.

## Session Continuity

Last session: 2026-03-11T23:01Z
Stopped at: Completed 1-3 (Multi-Surface Provider Refactor)
Resume file: None
