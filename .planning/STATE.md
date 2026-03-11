# Project State

## Current Position

Phase: 0 (Scaffolding)
Plan: 2 of 2 (BaseWindow + WebContentsView Multi-Panel)
Status: Phase complete
Last activity: 2026-03-12 - Completed 0-2 (BaseWindow + WebContentsView Multi-Panel Main Process)

## Decisions

| # | Decision | Phase | Rationale |
|---|----------|-------|-----------|
| 1 | Six-surface Vite architecture | 0-1 | chat, cowork, code, browser, sidebar, tabbar as independent entry points |
| 2 | Node 20 LTS | 0-1 | Stable version compatible with Electron 39 |
| 3 | Chrome 130 build target | 0-1 | Matches Electron 39 Chromium |
| 4 | Application menu for shortcuts | 0-2 | Menu accelerators integrate with OS natively, appear in menu bar, don't conflict with other apps |
| 5 | Z-order: surfaces first, sidebar/tabbar on top | 0-2 | Ensures chrome views always render above surface panels |
| 6 | All views share preload-new.js | 0-2 | Unified API bridge; each surface gets same electronAPI interface |

## Blockers/Concerns

None.

## Session Continuity

Last session: 2026-03-12T22:57Z
Stopped at: Completed 0-2 (BaseWindow + WebContentsView Multi-Panel Main Process)
Resume file: None
