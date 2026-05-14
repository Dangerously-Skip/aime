# IDE Mode — Code Surface Workspace

Planning doc for an IDE-style workspace on the Code surface. Brings file tree,
file viewer, diff viewer, terminal, and branch tools into one resizable layout
with togglable panels.

**Scope**: Code surface only. Chat / Cowork / Browser / Assistant unchanged.

**Status**: Scoping. Nothing built yet.

---

## Layout

Six regions. Every region can be **toggled visible/hidden** and **resized
within the available space**. State persists across launches.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Branch header  •  ahead/behind  •  Create PR                        │  ← header
├────────────┬──────────────────────────────────────┬──────────────────┤
│            │                                      │                  │
│   File     │       Tab strip (files / diffs)      │     Chat         │
│   tree     ├──────────────────────────────────────┤     pane         │
│            │                                      │                  │
│   filter   │       Viewer (file OR diff)          │   conversation   │
│            │                                      │   + composer     │
│            │                                      │                  │
│            ├──────────────────────────────────────┴──────────────────┤
│            │            Terminal (collapsible)                       │
└────────────┴─────────────────────────────────────────────────────────┘
```

### Panel inventory

| ID | Region | Default | Resize axis | Min / Max |
|---|---|---|---|---|
| `branchHeader` | top strip | visible | — | fixed 40px |
| `fileTree` | left rail | visible | horizontal | 180px / 480px |
| `tabStrip` | top of center | visible w/ viewer | — | fixed 36px |
| `viewer` | center | visible | vertical (vs terminal) | 30% / 100% of center |
| `terminal` | bottom of center | hidden | vertical (vs viewer) | 120px / 600px |
| `chat` | right rail | visible | horizontal | 280px / 50% of window |

### Resizable panels

- **Library**: `react-resizable-panels` (~25KB gz, Radix-compatible, no
  drag-overshoot bugs).
- **Drag handles**: three — between (tree/center), (center/chat),
  (viewer/terminal).
- **Snap-to-collapse**: dragging a handle past the min width fully collapses
  the panel and updates its visibility state. Re-toggle from the toolbar.
- **Persisted sizes** keyed by surface + workspace path so different repos
  remember their own layouts.

### Toggle UI

A toolbar in the branch header has six toggle buttons (lucide icons):
`PanelLeft`, `PanelRight`, `PanelBottom`, `Code`, `GitCompare`, `Terminal`.
Each is a sticky on/off; state in the settings store.

Keybinds:

| Key | Action |
|---|---|
| `Cmd+B` | Toggle file tree |
| `Cmd+J` | Toggle terminal |
| `Cmd+\` | Toggle chat pane |
| `Cmd+P` | Quick file open (focus tree filter) |
| `Cmd+Shift+P` | Command palette (later) |

### Persistence

```ts
// settings-store additions
codeWorkspaceLayout: {
  [workspacePath: string]: {
    treeWidth: number;
    chatWidth: number;
    terminalHeight: number;
    visible: { tree: boolean; chat: boolean; terminal: boolean; branchHeader: boolean };
    openTabs: Array<{ path: string; kind: 'file' | 'diff'; pinned: boolean }>;
  };
}
```

Falls back to defaults when a workspace path is first opened.

---

## Phases

### Phase 0 — Layout chassis & toggles (~1 day)

Build the panel scaffolding before any feature so each phase has somewhere to
mount.

- Add `react-resizable-panels` dependency
- New component `workspace-layout.tsx` with named panel slots
- Toolbar with six toggle buttons + tooltips + keybinds
- Settings-store entries for per-workspace layout
- Empty-state placeholders for every region (so devs can see the chassis
  before features land)

**Done when**: code surface opens with empty panels, each toggle works, drag
handles work, sizes persist.

### Phase 1 — File tree + viewer (~2 days)

- **Tree walk**: Electron IPC reads dir on demand (lazy expand). Use the
  `ignore` package to parse `.gitignore`. `.git` and `node_modules` are
  always hidden regardless of gitignore content.
- **Virtualized list**: `react-window` for folders >500 entries.
- **Filter input**: filename substring; `?text` prefix triggers content
  search via Bash + ripgrep if available, falls back to a node-side grep.
- **Click behaviour**:
  - Single-click on a file → preview tab (replaces previous preview)
  - Double-click → pin tab
  - Cmd+click → open in new tab
- **Tab strip**: ordered, draggable, close button, unsaved-dot indicator,
  scrolls horizontally when too many tabs.
- **Viewer pane**: wraps the existing `file-renderers/` modules — markdown,
  pdf, docx, xlsx, csv, image, code (syntax-highlighted). Zero new
  renderers.
- **File watcher**: `chokidar` on the working folder; debounced; invalidates
  cached file content + diff status.

**Risks**:
- Huge repos (10k+ files in one dir) — virtualize, lazy-load.
- Watcher CPU — debounce 200ms, ignore high-noise dirs (`.next`, `dist`).

### Phase 2 — Git plumbing + diff viewer (~2 days)

- **Git operations**: spawn `git` from Electron main via child_process. No
  JS git library — keeps native deps light.
  - `git status --porcelain=v1 -z` (parses cleanly, binary-safe)
  - `git diff --no-color`
  - `git diff --stat`
  - `git branch -a`, `git symbolic-ref HEAD`
  - `git rev-list --count base..HEAD` for ahead/behind
- **Cache + debounce**: status runs at most every 500ms during a watcher
  storm. Diffs cached per `(file, refA, refB)` triple.
- **Diff viewer**: `@git-diff-view/react` (~80KB gz). Looks like the
  Claude Code screenshot out of the box. Supports:
  - Unified / side-by-side toggle (header button)
  - Hunk navigation (j/k or arrows)
  - "X unmodified lines" collapsed regions, click to expand
  - Syntax highlighting per file extension
- **Diff modes**:
  - Working tree vs HEAD (default)
  - HEAD vs base branch (e.g. main)
  - Two arbitrary branches
- **Wiring**: clicking a modified file in the tree opens its diff tab.
  Unmodified files open the normal viewer. Diff tabs have a distinct icon
  in the tab strip.

**Risks**: `git status` on monorepos can take seconds. Run async, show a
spinner, never block UI.

### Phase 3 — Branch header + Create PR (~1 day)

- Display: `main ← claude/feature-x` with chevron toggle to change the
  base; ahead/behind counters; `+N −N` line stats.
- **Branch picker** (popover): list `git branch -a`, recently-used at top,
  search input.
- **Create PR button**:
  - If branch isn't pushed: `git push origin <branch>`
  - Open PR via `mcp__github__create_pull_request` (already wired)
  - Title defaults to last commit subject; body defaults to last commit body
  - Toast on success with link to the PR
- **Authorization**: GitHub MCP is already provisioned via OAuth (PR #2
  from earlier in repo history).

**Risks**: detecting the right remote / base when origin is forked, or when
the user has multiple remotes (origin + personal). Default to `origin/HEAD`,
allow override.

### Phase 4 — Terminal (~3 days)

The hardest phase. Optional — defer if unsure.

- **Stack**: `xterm.js` + `xterm-addon-fit` + `xterm-addon-web-links` in
  renderer; `node-pty` in Electron main.
- **IPC bridge**:
  - renderer → main: `pty:input(bytes)`, `pty:resize(cols, rows)`
  - main → renderer: `pty:output(bytes)`, `pty:exit(code)`
- **Per-conversation PTYs**: one shell per Code conversation, cwd = current
  folder. Persisted across surface switches (the PTY stays alive). Killed
  on conversation close.
- **Cross-platform**:
  - mac / linux: `pty.spawn(process.env.SHELL || 'bash', [], { cwd, env })`
  - Windows: ConPTY (bundled with node-pty) running `powershell.exe`
- **Theming**: xterm theme object derived from Quarry's CSS variables so it
  matches dark/light.
- **Multi-terminal**: tabs within the terminal panel (just like the file
  tab strip). v1 can ship single-terminal and add tabs later.

**Native-module pain** (budget half a day for this alone):
- `node-pty` ships prebuilt binaries for darwin-arm64, darwin-x64,
  win32-x64, win32-arm64, linux-x64 — usually fine
- `electron-builder` config needs to mark `node-pty` as an asar-unpacked
  native module so the binary is loadable post-packaging
- macOS signing: the prebuilt `.node` file inherits its parent's signature;
  no extra work usually needed but worth verifying notarisation
- `postinstall` may need `electron-rebuild` if a host npm version drifts

**Why this might not be worth it**: the agent already has the Bash tool,
which covers 90% of "run a command" use cases. The terminal adds value
mainly for interactive flows (running a dev server in the foreground,
attaching to a debugger). Worth confirming before building.

### Phase 5 — Polish (~1 day)

- Empty states for every panel (no folder, no changes, no terminal yet)
- Loading skeletons (tree walk, git status, diff fetch)
- Error states (git command failed, file too large, binary file)
- Keybind cheat-sheet popover
- Accessibility: focus management between panels (Cmd+1..6)
- Telemetry: ide_mode_panel_toggled, ide_mode_diff_opened, etc.

---

## Total effort

| Variant | Phases | Days |
|---|---|---|
| **Full IDE** (everything in screenshot) | 0-5 | **~9 days** |
| **No terminal** | 0-3, 5 | **~6 days** |
| **No terminal, no diff** | 0-1, 5 | **~4 days** |
| **Minimum viable** (tree + viewer only, no toggles) | 1 | **~2 days** |

---

## Dependencies to add

| Package | Size (gz) | Purpose |
|---|---|---|
| `react-resizable-panels` | ~25KB | Resizable layout |
| `react-window` | ~40KB | Virtualized tree |
| `ignore` | ~10KB | `.gitignore` parser |
| `@git-diff-view/react` | ~80KB | Diff renderer |
| `chokidar` | already present? | File watcher |
| `xterm` + addons | ~150KB | Terminal renderer |
| `node-pty` | native (~2MB / platform) | Terminal backend |
| **Total JS** (full) | **~305KB gz** | |
| **Total JS** (no terminal) | **~155KB gz** | |

---

## File / module layout

```
web/src/components/surfaces/code/
  code-surface.tsx                       ← gets new layout
  workspace/
    workspace-layout.tsx                 ← Phase 0
    panel-toolbar.tsx                    ← toggles
    branch-header.tsx                    ← Phase 3
    branch-picker.tsx                    ← Phase 3
    file-tree.tsx                        ← Phase 1
    file-tree-node.tsx                   ← Phase 1
    file-tree-filter.tsx                 ← Phase 1
    tab-strip.tsx                        ← Phase 1
    viewer-pane.tsx                      ← Phase 1
    diff-viewer.tsx                      ← Phase 2
    terminal.tsx                         ← Phase 4
    empty-states.tsx                     ← Phase 5
web/src/lib/code-workspace/
  git-ops.ts                             ← Phase 2 — IPC wrappers
  file-watcher.ts                        ← Phase 1 — chokidar wrapper
  fs-tree.ts                             ← Phase 1 — gitignore-aware walker
  pty-client.ts                          ← Phase 4 — renderer side
web/src/hooks/
  use-code-workspace.ts                  ← Phase 0 — layout + tabs state
  use-git-status.ts                      ← Phase 2
  use-file-tree.ts                       ← Phase 1
  use-pty.ts                             ← Phase 4
web/main-web.js                          ← extend for fs walk + git + pty
web/preload-web.js                       ← bridge new IPC channels
```

---

## Open questions to resolve before building

1. **Tab persistence**: do open tabs survive conversation switch and Quarry
   restart, or reset every time? Recommendation: persist per workspace.
2. **Chat-pane default width**: keep at current full-width, push to a 30%
   side rail, or make it user-configurable from the start? Recommendation:
   30% default, toggle to full-screen.
3. **Terminal really needed?** Strongly suggest deferring until we have a
   concrete user request the agent's Bash can't cover. Adds ~3 days +
   native-build risk.
4. **Multi-folder workspaces** (VS Code style)? Recommend no — keeps tree
   logic simple.
5. **Git history view** (commits, blame) — in this scope or follow-up?
   Recommendation: follow-up.
6. **Where does the chat composer live?** If chat moves to a side panel,
   does it lose the rich composer (attachments, voice, scratch-space)?
   They need to coexist.
7. **Conflict with FolderPicker bottom bar**: the bottom bar with
   FolderPicker + EditorPicker should probably collapse into the new
   layout (folder name lives in branch header; editor opens from tree
   context menu).

---

## Risks ranked

| Risk | Probability | Cost | Mitigation |
|---|---|---|---|
| node-pty native build / signing | High | 0.5-1 day | Budget half a day; have a fallback to defer Phase 4 |
| Performance on monorepos | Medium | 0.5 day | Virtualize tree, debounce git status, lazy-expand |
| Layout state drift across resizes | Medium | 0.5 day | Persist sizes per workspace; reset-to-defaults action |
| File watcher CPU on `.next` / `dist` | Low | 0.25 day | Hard-coded ignore list + `.gitignore` |
| Diff library can't handle huge diffs | Low | 0.25 day | Cap shown hunks at 1000 lines, show "load more" |

---

## Suggested rollout

1. PR `feat/ide-mode-phase-0` — layout chassis + toggles + persistence
2. PR `feat/ide-mode-phase-1` — file tree + viewer
3. PR `feat/ide-mode-phase-2` — git + diff
4. PR `feat/ide-mode-phase-3` — branch header + Create PR
5. PR `feat/ide-mode-phase-4` — terminal (conditional on user demand)
6. PR `feat/ide-mode-phase-5` — polish

Each phase merges to master behind a feature flag (`useIdeMode` in settings
store) until Phase 5 lands.

---

## Decisions (locked 2026-05-14)

- [x] **No feature flag.** Build directly on `IDEMode` branch; merge to
      master when integrated. Replaces the current Code surface in one cut.
- [x] **Terminal IS in v1.** Phase 4 is included, not deferred.
- [x] **Tab persistence: yes**, per workspace, survives launches.
- [x] **Chat at 30% side rail default**, remembered per workspace.
- [x] **Bottom bar collapses.** `FolderPicker` → branch header, `EditorPicker`
      → kebab on branch header + right-click in tree.
- [x] **No multi-folder workspaces** in v1.
- [x] **Git history view IS in v1** — extends Phase 3 (commits list + blame).
- [x] **Chat composer stays the hero.** Rich composer preserved (attachments,
      voice, scratch-space). Panels are reorderable so the user can collapse
      / reshuffle other regions to make room when they want the composer big.

## Reorderable panels (added requirement)

Beyond the resize/toggle support already in the plan, every non-fixed region
can be **moved into a different slot** at runtime:

- Drag a panel header onto another region's edge → swap or stack
- Stacked panels show as tabs at the top of the merged region
- Layout-reset action restores defaults

Implementation: `react-resizable-panels` covers resize + toggle. For
drag-to-rearrange we add a thin layer that swaps named panel slots in the
persisted layout state. No DnD library beyond `@dnd-kit` (already installed
for kanban).

## Swarm execution plan

Wave-based, multi-agent. Each agent works in its own git worktree so we
don't step on `node_modules`, branch state, or each other's files. Each
returns a branch ready to merge into `IDEMode`.

### Wave 1 — Phase 0 chassis (sequential, ~1 day)

I build this. It defines every interface the parallel phases plug into:

- `workspace-layout.tsx` with named panel slots: `branch`, `tree`, `tabs`,
  `viewer`, `terminal`, `chat`
- Resize + toggle + drag-to-rearrange scaffold (empty placeholder content
  per slot)
- `settings-store.codeWorkspaceLayout` schema covering visibility, sizes,
  slot positions, open tabs
- IPC channels declared in `preload-web.js` (empty handlers in
  `main-web.js` for the parallel phases to fill):
  - `fs:walk`, `fs:read`, `fs:watch-start`, `fs:watch-stop`
  - `git:status`, `git:diff`, `git:branches`, `git:log`, `git:blame`
  - `pty:open`, `pty:input`, `pty:resize`, `pty:close`, `pty:output`
- Hook stubs:
  - `useFileTree`, `useGitStatus`, `useGitLog`, `usePty`, `useCodeWorkspace`
- Phase 0 ends with a Code surface that opens with empty panels, all
  toggle/resize/drag wired, persistence working.

Once Wave 1 is committed to `IDEMode`, Wave 2 fans out.

### Wave 2 — Phases 1–4 in parallel (4 agents, ~3 days wall clock)

Each agent gets an isolated worktree, a clear task brief, and a target
branch. Conflicts minimised because each phase owns a disjoint set of
files thanks to the slot/hook boundaries Wave 1 established.

| Agent | Branch | Owns | Touches |
|---|---|---|---|
| **A: Tree + viewer** | `feat/ide-phase-1-tree-viewer` | `file-tree.tsx`, `file-tree-node.tsx`, `file-tree-filter.tsx`, `tab-strip.tsx`, `viewer-pane.tsx`, `fs-tree.ts`, `file-watcher.ts`, `use-file-tree.ts` | fills `fs:*` IPC handlers; fills tree + viewer slots |
| **B: Git + diff** | `feat/ide-phase-2-git-diff` | `diff-viewer.tsx`, `git-ops.ts`, `use-git-status.ts` | fills `git:status` / `git:diff` IPC handlers; renders diff tabs |
| **C: Branch + history** | `feat/ide-phase-3-branch-history` | `branch-header.tsx`, `branch-picker.tsx`, `git-history.tsx`, `blame-view.tsx`, `use-git-log.ts` | fills `git:branches` / `git:log` / `git:blame` handlers; relocates FolderPicker + EditorPicker; wires Create PR via GitHub MCP |
| **D: Terminal** | `feat/ide-phase-4-terminal` | `terminal.tsx`, `pty-client.ts`, main-process pty manager | fills `pty:*` IPC handlers; node-pty + electron-builder unpacked asar config; xterm.js mount |

**Coordination rules for the agents**:
1. Worktree-isolated; never edit files outside their owned list except
   `package.json` / lockfile (for new deps).
2. New IPC handlers fill the empty implementations Wave 1 declared — they
   don't add new channels (avoids preload drift).
3. New settings-store fields go under the existing `codeWorkspaceLayout`
   object — no top-level new keys.
4. All four push their branch when done; integration is Wave 3.

### Wave 3 — Merge + integrate (sequential, ~0.5 day)

I drive this. Merge order:

1. `feat/ide-phase-2-git-diff` (smallest surface area)
2. `feat/ide-phase-3-branch-history` (depends on git-ops from #2)
3. `feat/ide-phase-1-tree-viewer` (largest UI surface; merges into
   workspace-layout)
4. `feat/ide-phase-4-terminal` (independent, lowest conflict risk last)

Conflicts expected in `code-surface.tsx`, `package.json`,
`preload-web.js`, `main-web.js` — but small and obvious. Worktree pushes
mean I can resolve linearly without breaking any agent's working state.

End-to-end smoke after each merge:
- Open Code surface → all panels visible
- Walk tree → file opens in viewer
- Modified file → diff opens
- Drag panel header → re-arrange works
- Branch picker → Create PR fires
- Terminal opens → can run a command

### Wave 4 — Phase 5 polish (sequential, ~1 day)

Single agent (probably me). Empty states, errors, keybinds, accessibility,
telemetry. Then merge `IDEMode` to master with a v1.7.0 release.

## Wall-clock estimate

| Wave | Work | Days |
|---|---|---|
| 1 | Chassis (sequential) | 1 |
| 2 | Phases 1–4 in parallel | 3 (wall clock) |
| 3 | Merge + integrate | 0.5 |
| 4 | Polish + release | 1 |
| **Total** | | **~5.5 days wall clock** (~9 days of effort across 4 agents) |

Wall-clock save vs serial: ~3.5 days.

## Risks added by the swarm approach

| Risk | Mitigation |
|---|---|
| Two agents add the same npm dep, lockfile conflicts | Wave 1 pre-installs all deps in a placeholder commit |
| Agent A writes to a slot Agent B also touches | Slot/hook ownership table above — strict |
| One agent's branch breaks the typecheck others depend on | Each branch must `npm run typecheck` clean before push |
| Time-zone of dependency hell during merge | Merge in dependency order (see Wave 3); typecheck after each |
