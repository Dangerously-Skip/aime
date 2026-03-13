# nib Cowork — Build Plan

A feature-rich Claude Desktop clone with four interactive surfaces: Chat, Cowork, Code, and Agentic Browser. Built with Electron, Claude Agent SDK, AWS Bedrock inference, Playwright MCP, and Composio Tool Router.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Shell                        │
│  BaseWindow + WebContentsView (multi-panel composition)  │
│                                                         │
│  ┌──────┐ ┌────────────────────────────────────────┐    │
│  │ Side │ │  Tab Bar: [ Chat | Cowork | Code | 🌐 ] │    │
│  │ bar  │ ├────────────────────────────────────────┤    │
│  │      │ │                                        │    │
│  │ Chat │ │         Active Surface Panel           │    │
│  │ hist │ │                                        │    │
│  │ File │ │   Chat: Conversation + Artifacts       │    │
│  │ tree │ │   Cowork: Agent + Diffs + File Tree    │    │
│  │ Nav  │ │   Code: Terminal (xterm.js + node-pty) │    │
│  │      │ │   Browser: WebContentsView + Agent     │    │
│  │      │ │                                        │    │
│  └──────┘ └────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌─────────────────────────┐
│  Express Server  │  │   Claude Agent SDK      │
│  (Port 3001)     │  │   (subprocess per       │
│  SSE Streaming   │  │    surface config)      │
│  Surface Router  │  │                         │
└────────┬────────┘  │  Built-in tools:         │
         │           │  Read, Write, Edit, Bash │
         ▼           │  Glob, Grep, WebSearch   │
┌─────────────────┐  │  WebFetch, Agent, Todo   │
│  AWS Bedrock     │  │                         │
│  (Claude Inf.)   │  │  MCP Servers:           │
│                  │  │  - Composio (500+ apps) │
│  Env vars:       │  │  - Playwright (browser) │
│  CLAUDE_CODE_    │  └─────────────────────────┘
│  USE_BEDROCK=1   │
│  AWS_REGION=...  │
└─────────────────┘
```

### Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Inference** | AWS Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` — Agent SDK has native support, no proxy needed |
| **Agent Runtime** | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) | Full Claude Code runtime: 18+ built-in tools, agent loop, system prompt, permissions, hooks, sessions, subagents, file checkpointing — all for free |
| **Desktop Framework** | Electron with `BaseWindow` + `WebContentsView` | Multi-panel composition, each surface is its own renderer process |
| **Terminal** | xterm.js + node-pty | Real PTY terminal for Code surface |
| **Browser Automation** | Playwright MCP (`@playwright/mcp`) | TypeScript-native, 34+ browser tools, direct Agent SDK integration |
| **App Integrations** | Composio MCP | 500+ apps (Gmail, Slack, GitHub, Calendar, etc.) |
| **Build System** | Vite | Fast bundling, ESM-native, handles Monaco/xterm workers |
| **UI** | Vanilla JS modules (no framework) | Matches existing codebase, avoids framework overhead for Electron |

---

## Phase 0 — Foundation & Build System

**Goal:** Modernize the project structure, add a build system, and establish the multi-surface Electron shell with tab switching.

### Task 0.1 — Project Scaffolding & Build System

Set up Vite as the build system for both renderer and server code.

- [ ] Create `vite.config.js` for renderer builds (handles xterm, monaco, marked, diff2html)
- [ ] Add `electron-builder` config for production packaging
- [ ] Consolidate duplicate dependencies between root and server `package.json`
- [ ] Pin all `latest` dependencies to specific versions (`@composio/core`, `@opencode-ai/sdk`)
- [ ] Add `.nvmrc` with Node.js 20 LTS
- [ ] Create `scripts/dev.sh` that starts server + Electron concurrently
- [ ] Add `electron-rebuild` script for native modules (`node-pty`)

**New dependencies:**
```
vite, electron-builder, electron-rebuild, concurrently
```

### Task 0.2 — Electron Multi-View Architecture

Replace single `BrowserWindow` with `BaseWindow` + `WebContentsView` for multi-panel composition.

- [ ] Refactor `main.js` from `BrowserWindow` to `BaseWindow`
- [ ] Create 6 `WebContentsView` instances: sidebar, tabBar, chatPanel, coworkPanel, codePanel, browserPanel
- [ ] Implement `switchTab(tabName)` — adds active panel to contentView, removes others
- [ ] Implement resize handler — recalculates bounds for all views on window resize
- [ ] Wire IPC channels between main process and each view
- [ ] Implement keyboard shortcuts for tab switching (Cmd+1/2/3/4)
- [ ] Handle window lifecycle (close, minimize, fullscreen) for all views
- [ ] Create separate HTML entry points: `renderer/chat.html`, `renderer/cowork.html`, `renderer/code.html`, `renderer/browser.html`, `renderer/sidebar.html`, `renderer/tabbar.html`
- [ ] Create shared `renderer/preload.js` with per-surface API exposure

### Task 0.3 — Segmented Tab Control

Build the tab bar exactly matching Claude Desktop's pill-shaped segmented control.

- [ ] Create `renderer/tabbar/` with `index.html`, `tabbar.js`, `tabbar.css`
- [ ] Implement radio-input segmented control: Chat | Cowork | Code | Browser (4 segments)
- [ ] Add animated sliding indicator (CSS transform with cubic-bezier easing)
- [ ] Wire tab selection IPC: `tabbar:switch` → main process → show/hide panels
- [ ] Add back/forward navigation arrows (left of tabs, matching screenshot)
- [ ] Add sidebar toggle button (left of navigation)
- [ ] Add user avatar / settings icon (right side)
- [ ] Match exact Claude Desktop styling: warm dark background, pill shape, white text on active

### Task 0.4 — Design System & Dark Theme

Establish CSS custom properties matching Claude Desktop's warm dark aesthetic.

- [ ] Create `renderer/shared/theme.css` with full CSS variable system (colors, typography, spacing, shadows, radii, transitions)
- [ ] Colors: warm dark backgrounds (#1a1714, #242019, #2d2820), terracotta accent (#e07a5f), warm white text (#e8e0d4)
- [ ] Typography: system sans-serif for UI, monospace for code (Berkeley Mono / JetBrains Mono fallback)
- [ ] Create `renderer/shared/base.css` with reset, scrollbar styling, focus rings, selection color
- [ ] Create reusable component styles: `.btn`, `.btn-primary`, `.input`, `.card`, `.badge`, `.tooltip`
- [ ] Import Claude's grid-dot background pattern for Cowork surface (visible in screenshot)
- [ ] Create streaming cursor animation (terracotta blinking caret)

### Task 0.5 — Shared Module Library

Extract reusable logic from the existing monolithic `renderer.js` into importable ES modules.

- [ ] `renderer/shared/sse-parser.js` — SSE stream reader (extract from existing renderer.js lines 843-975)
- [ ] `renderer/shared/markdown-renderer.js` — Streaming markdown renderer using `marked` (extract chunked container pattern)
- [ ] `renderer/shared/tool-call-renderer.js` — Inline tool call cards with expandable I/O (extract addInlineToolCall/updateInlineToolResult)
- [ ] `renderer/shared/thinking-renderer.js` — Collapsible extended thinking sections
- [ ] `renderer/shared/state-manager.js` — localStorage persistence with per-surface namespacing
- [ ] `renderer/shared/input-area.js` — Reusable chat input component (textarea, model selector, send button, file attach)
- [ ] `renderer/shared/message-list.js` — Scrollable message container with auto-scroll and scroll-lock
- [ ] Bundle `marked` locally instead of CDN (offline reliability)

---

## Phase 1 — Server & Provider Refactor

**Goal:** Refactor the backend to support per-surface agent configurations, Bedrock inference, and concurrent multi-surface streaming.

### Task 1.1 — Surface Configuration System

Create per-surface Agent SDK configurations that define tools, permissions, system prompts, and MCP servers.

- [ ] Create `server/surfaces/chat-config.js`:
  - `allowedTools`: `['WebSearch', 'WebFetch']`
  - `permissionMode`: `'default'`
  - `systemPrompt`: Custom conversational prompt
  - `model`: `'sonnet'` (default)
  - No MCP servers
- [ ] Create `server/surfaces/cowork-config.js`:
  - `allowedTools`: `['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Agent', 'WebSearch', 'WebFetch', 'TodoWrite', 'AskUserQuestion']`
  - `permissionMode`: `'acceptEdits'`
  - `systemPrompt`: `{ type: 'preset', preset: 'claude_code', append: 'knowledge work instructions...' }`
  - `settingSources`: `['user', 'project']`
  - `enableFileCheckpointing`: `true`
  - `mcpServers`: Composio MCP
- [ ] Create `server/surfaces/code-config.js`:
  - `allowedTools`: all tools + `'EnterWorktree'`, `'NotebookEdit'`
  - `permissionMode`: `'acceptEdits'`
  - `systemPrompt`: `{ type: 'preset', preset: 'claude_code' }`
  - `settingSources`: `['user', 'project', 'local']`
  - `enableFileCheckpointing`: `true`
  - `model`: `'sonnet'` (switchable to `'opus'`)
- [ ] Create `server/surfaces/browser-config.js`:
  - `allowedTools`: `['WebSearch', 'WebFetch', 'mcp__playwright__*']`
  - `permissionMode`: `'acceptEdits'`
  - `systemPrompt`: Custom browser assistant prompt
  - `mcpServers`: Playwright MCP
  - `model`: `'sonnet'`
- [ ] Create `server/surfaces/index.js` — factory function `getSurfaceConfig(surfaceName, overrides)`

### Task 1.2 — Bedrock Integration

Configure the Agent SDK to use AWS Bedrock for all inference.

- [ ] Update `.env.example` with Bedrock variables: `CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_PROFILE`
- [ ] Update `setup.sh` to prompt for AWS credentials and region
- [ ] Create `server/bedrock-env.js` — helper that assembles the `env` object for Agent SDK options:
  ```js
  export function getBedrockEnv() {
    return {
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: process.env.AWS_REGION,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
    };
  }
  ```
- [ ] Update `claude-provider.js` to pass `env: getBedrockEnv()` in all `query()` calls
- [ ] Add model mapping: UI names (`sonnet`, `opus`, `haiku`) → Bedrock model IDs
- [ ] Add IAM permission documentation to README
- [ ] Add health check endpoint that verifies Bedrock connectivity (`sts:GetCallerIdentity`)

### Task 1.3 — Multi-Surface Provider Refactor

Refactor the provider system to support concurrent queries across surfaces with surface-specific configs.

- [ ] Update `BaseProvider` to accept `surfaceId` in `query()` params
- [ ] Update `ClaudeProvider.query()` to merge surface config with per-call overrides
- [ ] Change session key from `chatId` to `surfaceId:chatId` composite key
- [ ] Support multiple concurrent `AbortController` instances (one per surface, not one global)
- [ ] Add `includePartialMessages: true` to all surface configs (streaming)
- [ ] Implement per-surface cost tracking (`ResultMessage.total_cost_usd`)
- [ ] Add `maxBudgetUsd` enforcement per surface (configurable in surface configs)

### Task 1.4 — Server API Expansion

Add surface routing and new endpoints for multi-surface operations.

- [ ] Add `surfaceId` parameter to `POST /api/chat` — routes to correct surface config
- [ ] Add `POST /api/chat/:surfaceId` — surface-specific chat endpoint (cleaner routing)
- [ ] Add `GET /api/surfaces` — returns available surfaces with their configs and capabilities
- [ ] Add `GET /api/sessions/:surfaceId` — list past sessions for a surface
- [ ] Add `POST /api/sessions/:surfaceId/resume` — resume a specific session
- [ ] Add `POST /api/rewind/:surfaceId` — rewind file changes to a checkpoint (Cowork/Code)
- [ ] Add `GET /api/models` — returns available models (with Bedrock availability check)
- [ ] Add `GET /api/cost` — returns cumulative cost tracking across surfaces
- [ ] Add WebSocket support alongside SSE for bidirectional communication (tool approval prompts, permission requests)

### Task 1.5 — Hook System for UI Integration

Implement Agent SDK hooks that emit real-time events to the frontend.

- [ ] Create `server/hooks/tool-monitor.js` — PreToolUse/PostToolUse hooks that emit tool start/complete events via SSE
- [ ] Create `server/hooks/file-watcher.js` — PostToolUse hook on Edit/Write that emits file change events (for file tree refresh)
- [ ] Create `server/hooks/permission-bridge.js` — Bridges SDK permission prompts to frontend UI (for user approval in non-bypass modes)
- [ ] Create `server/hooks/cost-tracker.js` — Tracks per-surface and per-session costs
- [ ] Create `server/hooks/audit-logger.js` — Logs all tool executions to `~/.nibcowork/audit.log`
- [ ] Wire hooks into surface configs (Cowork and Code surfaces get all hooks; Chat gets cost tracker only)

---

## Phase 2 — Chat Surface

**Goal:** Build a polished conversational AI interface matching Claude Desktop's Chat tab.

### Task 2.1 — Chat UI Layout

Build the Chat surface matching the first screenshot exactly.

- [ ] Create `renderer/chat/index.html` — minimal shell loading chat.js and theme.css
- [ ] Create `renderer/chat/chat.js` — main Chat surface module
- [ ] Create `renderer/chat/chat.css` — Chat-specific styles
- [ ] Implement home view: centered greeting ("Good morning, {name}"), input area, prompt chips
- [ ] Implement chat view: scrollable message list, pinned input area at bottom
- [ ] Add time-based greeting: "Good morning/afternoon/evening, {name}" with seasonal emoji
- [ ] Implement smooth transition from home view → chat view on first message

### Task 2.2 — Chat Input Area

Build the input area matching Claude Desktop's design.

- [ ] Auto-expanding textarea with placeholder "Type / for commands"
- [ ] `+` button (left) for file attachments and connectors
- [ ] Model selector dropdown (right) — shows current model (e.g., "Sonnet 4.6 ▾")
- [ ] Send button (right, terracotta orange arrow-up circle)
- [ ] Send on Enter, newline on Shift+Enter
- [ ] Slash command detection: typing `/` shows command palette
- [ ] File drag-and-drop zone (highlight input area on drag over)
- [ ] File attachment chips (show attached files below input, removable)
- [ ] Character/token count indicator (subtle, bottom-right)

### Task 2.3 — Prompt Chips & Quick Actions

Implement the suggestion chips below the input area.

- [ ] Render 5 chips: Write, Learn, Code, Life stuff, Claude's choice
- [ ] Each chip has an icon + label
- [ ] Click prefills the input with a relevant starter prompt
- [ ] Chips fade out and hide after first message is sent
- [ ] Animate chip appearance with staggered fade-in
- [ ] Make chips configurable (stored in localStorage, editable in settings)

### Task 2.4 — Message Rendering

Build the streaming message display.

- [ ] User messages: right-aligned bubble with warm accent background
- [ ] Assistant messages: left-aligned, full-width, markdown-rendered
- [ ] Streaming text: incremental markdown rendering with blinking terracotta cursor
- [ ] Extended thinking: collapsible "Thinking..." section above response (toggle with Cmd+T)
- [ ] Code blocks: syntax-highlighted with copy button and language label
- [ ] Inline tool calls: collapsible cards showing tool name, input JSON, output (for WebSearch/WebFetch results)
- [ ] Image rendering: inline display for image results
- [ ] Error messages: red-tinted card with error type and retry button
- [ ] Message timestamps (subtle, on hover)
- [ ] Copy message button (on hover)
- [ ] Regenerate button (on last assistant message)

### Task 2.5 — Chat Session Management

Implement multi-chat with persistence.

- [ ] Left sidebar: scrollable list of past chat sessions
- [ ] New chat button at top of sidebar
- [ ] Chat title: auto-generated from first message (or user-editable)
- [ ] Chat search/filter in sidebar
- [ ] Delete chat (with confirmation)
- [ ] Pin important chats to top
- [ ] Session resume via Agent SDK `resume` option (maintains full context)
- [ ] Persist chat metadata to localStorage, session transcripts managed by Agent SDK
- [ ] Show model used and cost per chat in sidebar

### Task 2.6 — Model Selector

Build the model dropdown matching Claude Desktop.

- [ ] Dropdown shows: Opus 4.6, Sonnet 4.6, Haiku 4.5
- [ ] Model locked after first message in a chat (grayed out with tooltip explaining why)
- [ ] Show model capabilities hint (Opus: "Most capable", Sonnet: "Balanced", Haiku: "Fast")
- [ ] Default model configurable in settings
- [ ] Visual indicator of which model is active (checkmark)
- [ ] Bedrock availability badge per model

---

## Phase 3 — Cowork Surface

**Goal:** Build the autonomous knowledge-work agent surface with file access, diffs, and tool monitoring.

### Task 3.1 — Cowork UI Layout

Build the Cowork surface matching the second screenshot.

- [ ] Home state: "Let's knock something off your list" heading, subtitle text, input area
- [ ] Grid-dot background pattern (CSS repeating radial gradient, matches screenshot)
- [ ] "Work in a folder" dropdown (left of input) — opens native folder picker dialog
- [ ] "Let's go →" button (terracotta, right of input) — replaces send button
- [ ] Model selector (Opus 4.6 default for Cowork — heavier tasks)
- [ ] Active state: split view — conversation left, tool activity / file tree right

### Task 3.2 — Folder Picker & Working Directory

Implement the "Work in a folder" system.

- [ ] Native folder picker via Electron `dialog.showOpenDialog({ properties: ['openDirectory'] })`
- [ ] Display selected folder name in dropdown chip
- [ ] Recent folders history (last 5, stored in localStorage)
- [ ] Pass selected folder as `cwd` to Agent SDK
- [ ] Permission explanation dialog: "Claude will be able to read and edit files in this folder"
- [ ] Auto-detect project type (look for package.json, Cargo.toml, etc.) and show project icon
- [ ] Load CLAUDE.md from selected folder if present

### Task 3.3 — Tool Activity Feed

Real-time visualization of agent tool usage.

- [ ] Right sidebar panel: "Activity" header with live tool call list
- [ ] Each tool call shows: icon, tool name, status (running/complete/error), elapsed time
- [ ] Running tools show animated spinner
- [ ] Completed tools show green checkmark with result summary
- [ ] Failed tools show red X with error message
- [ ] Click to expand: full input JSON and output content
- [ ] Tool categories with icons: 📄 File ops (Read/Write/Edit), 🔍 Search (Glob/Grep), 💻 Terminal (Bash), 🌐 Web (WebSearch/WebFetch), 🔧 MCP tools
- [ ] Auto-scroll to latest tool call
- [ ] Counter badge: "12 tool calls" at top

### Task 3.4 — Visual Diff Viewer

Render file diffs from Edit/Write tool outputs.

- [ ] Integrate `diff2html` with dark theme overrides
- [ ] Side-by-side diff mode (default) and line-by-line mode (toggle)
- [ ] Show diffs inline in conversation when Edit/Write tools complete
- [ ] File path header with open-in-editor button
- [ ] Line numbers with highlight on hover
- [ ] Expandable context (show more surrounding lines)
- [ ] Accept/Reject buttons per diff (wired to file checkpointing rewind)
- [ ] Batch accept all / reject all for multi-file changes

### Task 3.5 — File Tree Sidebar

Collapsible file tree for the working directory.

- [ ] Recursive directory tree with lazy-loading (expand on click)
- [ ] File icons by extension (JS, TS, JSON, MD, etc.)
- [ ] Highlight files modified by agent (yellow dot indicator)
- [ ] Highlight files created by agent (green dot indicator)
- [ ] Click file to preview content in a read-only panel
- [ ] Right-click context menu: Open, Copy path, Reveal in Finder
- [ ] .gitignore-aware: gray out or hide ignored files
- [ ] Refresh on file system changes (via PostToolUse hook on Write/Edit)
- [ ] Search files within tree (filter input at top)

### Task 3.6 — Subagent Visualization

Show subagent spawning and results in the UI.

- [ ] When `Agent` tool is called, show nested agent card in conversation
- [ ] Card shows: subagent name, description, status (running/complete)
- [ ] Expandable: show subagent's internal tool calls and reasoning
- [ ] Visual nesting: indented or bordered differently from main conversation
- [ ] Multiple concurrent subagents shown as parallel tracks

### Task 3.7 — Task/Todo Tracking

Display TodoWrite tool output as a structured task list.

- [ ] Right sidebar panel: "Tasks" section
- [ ] Render todo items with status: pending (○), in-progress (◐), completed (●)
- [ ] Progress bar at top showing overall completion
- [ ] Click task to see details
- [ ] Tasks persist across messages (accumulate from multiple TodoWrite calls)
- [ ] Export task list (copy as markdown)

### Task 3.8 — Composio MCP Integration

Set up Composio Tool Router for 500+ app integrations.

- [ ] Initialize Composio MCP server in `server/server.js` (reuse existing pattern)
- [ ] Pass Composio MCP URL to Cowork surface config
- [ ] Create connector setup UI: "Connect Apps" button in sidebar
- [ ] Show connected apps with status icons
- [ ] OAuth flow handling for new app connections (opens browser for auth)
- [ ] App-specific tool filtering (only show connected app tools)

### Task 3.9 — File Checkpointing & Rewind

Expose the Agent SDK's file checkpointing as a UI feature.

- [ ] Enable `enableFileCheckpointing: true` in Cowork config
- [ ] Show checkpoint markers in conversation timeline (after each user message)
- [ ] "Rewind to here" button on each checkpoint
- [ ] Confirmation dialog showing which files will be restored/deleted
- [ ] Visual indication of current checkpoint state
- [ ] Wire to `POST /api/rewind/:surfaceId` endpoint

---

## Phase 4 — Code Surface

**Goal:** Build an embedded terminal running Claude Code with full PTY support, matching Claude Desktop's Code tab.

### Task 4.1 — Terminal Emulator Setup

Set up xterm.js + node-pty for a real terminal experience.

- [ ] Install and rebuild `node-pty` for Electron (`npx electron-rebuild -f -w node-pty`)
- [ ] Create PTY manager in main process (`main/pty-manager.js`): spawn, input, resize, destroy
- [ ] Create xterm.js renderer (`renderer/code/terminal.js`) with WebGL addon for performance
- [ ] Wire IPC: `terminal:create`, `terminal:input`, `terminal:data:{id}`, `terminal:resize`, `terminal:exit:{id}`
- [ ] Apply Claude dark theme to xterm (warm colors: terracotta cursor, warm white text, dark warm background)
- [ ] Handle terminal resize on panel resize (FitAddon)
- [ ] Support terminal scrollback (10,000 lines)

### Task 4.2 — Code Surface UI Layout

Build the Code surface matching the third screenshot.

- [ ] Terminal fills the main panel area (dark background)
- [ ] Claude Code pig mascot centered above input on empty state
- [ ] Input area at bottom: text input with placeholder "Find a small todo in the codebase and do it"
- [ ] `+` button for file attachments
- [ ] `</> Auto accept edits ▾` dropdown — permission mode selector (auto accept / ask / plan only)
- [ ] Model selector: "Opus 4.6 ▾"
- [ ] Send button (terracotta)
- [ ] Bottom bar: "Select folder" button (left), "Local ▾" dropdown (right — Local vs Cloud execution)
- [ ] Multiple terminal sessions (tabs above terminal, "+ New session")

### Task 4.3 — Permission Mode Selector

Implement the "Auto accept edits" dropdown.

- [ ] Three modes matching Claude Code:
  - **Auto accept edits** → `permissionMode: 'acceptEdits'`
  - **Ask before editing** → `permissionMode: 'default'`
  - **Plan only** → `permissionMode: 'plan'`
- [ ] Visual indicator of current mode
- [ ] Keyboard shortcut: Shift+Tab to cycle modes
- [ ] Mode persists per session

### Task 4.4 — Folder Selection & Project Context

Implement the "Select folder" system for Code surface.

- [ ] "Select folder" button opens native directory picker
- [ ] Selected folder becomes `cwd` for PTY and Agent SDK
- [ ] Auto-detect git repo (show branch name)
- [ ] Load CLAUDE.md and project skills from selected folder
- [ ] Recent projects dropdown
- [ ] Show project name in bottom bar after selection

### Task 4.5 — Parallel Sessions with Git Worktrees

Support multiple isolated coding sessions.

- [ ] Session list in a tab bar above the terminal
- [ ] "+ New session" button creates a new git worktree (via Agent SDK `EnterWorktree`)
- [ ] Each session: own PTY instance, own Agent SDK session, own git branch
- [ ] Session status indicators: Active (green), Archived (gray)
- [ ] Switch between sessions (preserves terminal scrollback)
- [ ] Close session (kills PTY, optionally removes worktree)
- [ ] Filter: Active / Archived tabs

### Task 4.6 — Agent SDK ↔ Terminal Integration

Two modes: direct terminal (user runs `claude` CLI) or Agent SDK piped to xterm display.

- [ ] **Mode A — Direct Terminal**: Spawn PTY with Bedrock env vars, user types `claude` commands directly. Terminal is a real shell.
- [ ] **Mode B — SDK-Driven**: User types in the input area, Agent SDK `query()` runs, output is rendered in xterm-style display (formatted tool calls, diffs, etc.)
- [ ] Toggle between modes
- [ ] In SDK mode: render tool call progress, diffs, and thinking sections in the terminal output area
- [ ] In terminal mode: pass through all PTY I/O unmodified

### Task 4.7 — Visual Diff Review in Code Surface

Show file diffs inline in the Code surface.

- [ ] When Agent SDK Edit/Write tool completes, show diff in a slide-up panel
- [ ] Side-by-side diff view (diff2html with dark theme)
- [ ] Accept / Reject per file
- [ ] "Accept All" button
- [ ] Diff panel collapses when dismissed
- [ ] In direct terminal mode, detect diff output in PTY stream and enhance rendering

---

## Phase 5 — Browser Surface

**Goal:** Build an agentic browser with Playwright MCP integration, matching the Comet browser reference.

### Task 5.1 — Embedded Browser View

Set up the WebContentsView-based browser panel.

- [ ] Create dedicated `WebContentsView` for web page rendering (sandboxed: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`)
- [ ] Browser view takes ~70% of panel width (left), agent chat takes ~30% (right sidebar)
- [ ] Navigation controls: back, forward, refresh, URL bar
- [ ] URL bar: editable, shows current URL, submit to navigate
- [ ] Tab bar above browser view (multiple tabs support)
- [ ] New tab button (+)
- [ ] Close tab button (×)
- [ ] Tab shows page title and favicon

### Task 5.2 — Browser Navigation & IPC

Wire browser controls to the WebContentsView.

- [ ] IPC handlers: `browser:navigate(url)`, `browser:back()`, `browser:forward()`, `browser:refresh()`, `browser:stop()`
- [ ] URL validation and HTTPS upgrade
- [ ] Navigation events: `did-navigate`, `did-navigate-in-page` → update URL bar
- [ ] Page title updates → update tab label
- [ ] Loading indicator (progress bar under URL bar)
- [ ] New window requests → open in new tab (not external browser)
- [ ] Handle SSL certificate errors gracefully
- [ ] Bookmarks bar (optional, phase 6)

### Task 5.3 — Playwright MCP Integration

Connect the Playwright MCP server to the Agent SDK for browser automation.

- [ ] Configure Playwright MCP in browser surface config:
  ```js
  mcpServers: {
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] }
  }
  ```
- [ ] Map Playwright MCP tools to UI actions:
  - `browser_navigate` → show navigation in browser view
  - `browser_click` → highlight clicked element briefly
  - `browser_type` → show typing animation
  - `browser_screenshot` → display screenshot in chat
- [ ] Handle Playwright's accessibility snapshot results (structured element data)
- [ ] Agent can operate on a separate browser instance (Playwright-controlled) or the embedded view

### Task 5.4 — Agent Sidebar Chat

Build the right-side assistant chat panel (matching Comet's layout).

- [ ] Compact chat interface: message list + input area
- [ ] Input: "Type / for search modes" placeholder
- [ ] Model selector dropdown
- [ ] Voice input button (microphone icon, future phase)
- [ ] Send button
- [ ] Context indicator: "Viewing: {page title}" chip above input
- [ ] Page-aware: agent automatically has context of current page URL/title
- [ ] Agent responses rendered as markdown with tool call cards

### Task 5.5 — Page Summarization

One-click page summary feature.

- [ ] "Summarize" button in browser toolbar
- [ ] Captures current page content via `WebContentsView.webContents.executeJavaScript()` (extract readable text)
- [ ] Sends to Agent SDK with prompt: "Summarize this web page: {content}"
- [ ] Renders summary in the sidebar chat
- [ ] Works on articles, documentation, social media posts
- [ ] Option to save summary to a file

### Task 5.6 — Agent Action Overlay

Visual feedback when the agent is performing browser actions.

- [ ] Semi-transparent overlay on browser view during agent actions
- [ ] Action label: "Navigating to...", "Clicking...", "Typing...", "Scrolling..."
- [ ] Element highlight: brief outline around element being interacted with
- [ ] Screenshot flash: brief white flash when screenshot is taken
- [ ] Progress indicator for multi-step tasks
- [ ] Cancel button to abort agent action

### Task 5.7 — Multi-Tab Context

Allow the agent to work across multiple browser tabs.

- [ ] Agent can see list of open tabs (titles + URLs)
- [ ] Agent can switch between tabs
- [ ] Cross-tab context: "Compare the pricing on tab 1 and tab 2"
- [ ] Tab-specific conversation history
- [ ] Pin tabs to prevent agent from closing them

---

## Phase 6 — Cross-Surface Features

**Goal:** Features that span multiple surfaces — settings, connectors, search, and inter-surface communication.

### Task 6.1 — Settings Panel

Global settings accessible from sidebar.

- [ ] Settings icon in sidebar (gear icon)
- [ ] Settings modal/panel with sections:
  - **General**: Default model, user name (for greeting), theme (dark only initially)
  - **AWS Bedrock**: Region, credential method (env vars / profile / SSO), test connection button
  - **Composio**: API key, connected apps list, add new app
  - **Surfaces**: Per-surface defaults (model, permission mode, max budget)
  - **Keyboard Shortcuts**: View and customize shortcuts
- [ ] Settings persisted to `~/.nibcowork/settings.json`
- [ ] Hot-reload: changes take effect without restart

### Task 6.2 — MCP Server Management UI

Graphical MCP server configuration (matching Claude Desktop Code tab).

- [ ] "Connectors" section in settings
- [ ] List of configured MCP servers with status (running/stopped/error)
- [ ] Add new MCP server: name, command, args, env vars
- [ ] Edit existing server config
- [ ] Delete server (with confirmation)
- [ ] Test connection button per server
- [ ] Auto-discovery of popular MCP servers (Playwright, Composio, GitHub, etc.)
- [ ] Import from `opencode.json` or Claude Desktop config

### Task 6.3 — Global Search

Search across chat history, files, and sessions.

- [ ] Cmd+K global search palette
- [ ] Search scopes: Chat messages, File contents, Session transcripts
- [ ] Fuzzy matching on chat titles and message content
- [ ] Results grouped by surface and session
- [ ] Click result to navigate to that surface/session/message
- [ ] Recent searches history

### Task 6.4 — Cross-Surface Context Sharing

Allow surfaces to share context with each other.

- [ ] "Send to Cowork" button on Chat messages — forwards context to Cowork surface
- [ ] "Send to Code" button on Cowork tool results — opens Code surface with file context
- [ ] "Open in Browser" button on URLs in any surface — opens in Browser surface
- [ ] Shared clipboard: agent results from one surface available as context in another
- [ ] Cross-surface session linking: "Continue this in Code mode" preserves relevant context

### Task 6.5 — Notification System

Toast notifications for background events.

- [ ] Toast notification component (bottom-right corner)
- [ ] Notifications for: task complete, error occurred, permission needed, cost threshold reached
- [ ] Click notification to navigate to relevant surface
- [ ] Notification history panel
- [ ] Desktop-native notifications (Electron `Notification` API) when app is backgrounded
- [ ] Sound effects (optional, configurable)

### Task 6.6 — Cost Dashboard

Track and display Bedrock inference costs.

- [ ] Cost counter in status bar (bottom of sidebar)
- [ ] Per-surface cost breakdown
- [ ] Per-session cost
- [ ] Daily/weekly/monthly totals
- [ ] Cost alerts at configurable thresholds
- [ ] Export cost report (CSV)

---

## Phase 7 — Polish & Production

**Goal:** Production readiness — packaging, performance, error handling, and final UI polish.

### Task 7.1 — Error Handling & Recovery

Robust error handling across all surfaces.

- [ ] Network error recovery: auto-reconnect SSE streams with exponential backoff
- [ ] Bedrock auth error: detect expired credentials, prompt to refresh
- [ ] Agent SDK crash recovery: detect subprocess exit, offer restart
- [ ] MCP server crash: detect and restart, notify user
- [ ] Rate limiting: detect 429 from Bedrock, show cooldown timer
- [ ] Graceful degradation: if one surface errors, others continue working
- [ ] Error boundary per surface (one crash doesn't take down the app)
- [ ] User-facing error messages (human-readable, not stack traces)

### Task 7.2 — Performance Optimization

Ensure smooth performance with multiple surfaces.

- [ ] Lazy-load surface renderers (don't initialize all 4 on startup)
- [ ] Virtualized message lists for long conversations (only render visible messages)
- [ ] Debounce file tree refresh (batch rapid file changes)
- [ ] xterm.js WebGL renderer for terminal performance
- [ ] Monaco editor lazy loading (only for Cowork surface)
- [ ] Memory profiling: ensure no leaks from stream readers or IPC listeners
- [ ] Limit concurrent Agent SDK subprocesses (max 2-3 simultaneous)

### Task 7.3 — Keyboard Shortcuts

Comprehensive keyboard shortcut system.

- [ ] Cmd+1/2/3/4 — Switch surfaces (Chat/Cowork/Code/Browser)
- [ ] Cmd+N — New chat/session in current surface
- [ ] Cmd+K — Global search
- [ ] Cmd+, — Settings
- [ ] Cmd+T — Toggle extended thinking
- [ ] Cmd+Enter — Send message
- [ ] Cmd+. — Abort current query
- [ ] Cmd+Shift+S — Toggle sidebar
- [ ] Cmd+L — Focus URL bar (Browser surface)
- [ ] Cmd+W — Close current tab/session
- [ ] Escape — Cancel current action / close modal
- [ ] Shortcuts displayed in a help overlay (Cmd+/)

### Task 7.4 — Application Packaging

Package for distribution.

- [ ] `electron-builder` config for macOS (.dmg), Windows (.exe), Linux (.AppImage)
- [ ] Auto-updater setup (electron-updater)
- [ ] Code signing for macOS (Developer ID)
- [ ] Application icon (all required sizes)
- [ ] Splash screen during startup
- [ ] First-run setup wizard (AWS credentials, Composio key, select default folder)
- [ ] Handle native module packaging (`node-pty` binary bundling)

### Task 7.5 — Onboarding & First-Run Experience

Guide new users through setup.

- [ ] First-run detection (check for `~/.nibcowork/settings.json`)
- [ ] Step 1: Welcome screen with app overview
- [ ] Step 2: AWS Bedrock configuration (region, credentials, test connection)
- [ ] Step 3: Composio API key (optional, with explanation of what it enables)
- [ ] Step 4: Select default working directory
- [ ] Step 5: Choose default model and permission mode
- [ ] Skip option for experienced users
- [ ] Settings are re-accessible from settings panel

### Task 7.6 — Accessibility

Basic accessibility compliance.

- [ ] Keyboard navigation across all surfaces and controls
- [ ] ARIA labels on all interactive elements
- [ ] Focus management when switching surfaces
- [ ] Screen reader announcements for streaming messages
- [ ] High-contrast mode (optional theme variant)
- [ ] Reduced motion preference respected (disable animations)

### Task 7.7 — Documentation

User and developer documentation.

- [ ] Update README.md with new architecture and setup instructions
- [ ] Update CLAUDE.md with new project structure and development commands
- [ ] Inline code documentation for all new modules
- [ ] Architecture decision records (ADRs) for key decisions
- [ ] Troubleshooting guide for common issues (Bedrock auth, MCP server errors, native module builds)

---

## Dependency Summary

### Root `package.json`

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.7",
    "express": "^5.2.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "electron": "^39.2.7",
    "electron-builder": "^25.1.8",
    "electron-rebuild": "^3.2.9",
    "vite": "^6.0.0",
    "concurrently": "^9.1.0"
  }
}
```

### Server `package.json`

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.7",
    "@composio/core": "^0.8.0",
    "express": "^5.2.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5"
  }
}
```

### Renderer Dependencies (bundled via Vite)

```json
{
  "dependencies": {
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.18.0",
    "node-pty": "^1.0.0",
    "monaco-editor": "^0.52.0",
    "diff2html": "^3.4.48",
    "diff": "^7.0.0",
    "marked": "^15.0.0",
    "highlight.js": "^11.11.0"
  }
}
```

### MCP Servers (installed at runtime via npx)

```
@playwright/mcp@latest     — Browser automation (34+ tools)
composio-core              — 500+ app integrations via Composio
```

---

## Environment Variables

```bash
# AWS Bedrock (required)
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_SESSION_TOKEN=your-session-token    # If using temporary credentials

# Composio (optional, enables 500+ app integrations)
COMPOSIO_API_KEY=your-composio-api-key

# App Configuration
NIB_COWORK_PORT=3001                    # Server port
NIB_COWORK_DEFAULT_MODEL=sonnet         # Default model (sonnet/opus/haiku)
```

---

## Phase Execution Order

| Phase | Focus | Estimated Scope | Prerequisites |
|---|---|---|---|
| **Phase 0** | Foundation & Build System | Shell, tabs, theme, shared modules | None |
| **Phase 1** | Server & Provider Refactor | Bedrock, surface configs, hooks | Phase 0 |
| **Phase 2** | Chat Surface | Conversational UI, sessions, streaming | Phase 0 + 1 |
| **Phase 3** | Cowork Surface | Agent tools, diffs, file tree, Composio | Phase 0 + 1 |
| **Phase 4** | Code Surface | Terminal, PTY, worktrees, diffs | Phase 0 + 1 |
| **Phase 5** | Browser Surface | WebContentsView, Playwright MCP, tabs | Phase 0 + 1 |
| **Phase 6** | Cross-Surface Features | Settings, search, context sharing, costs | Phases 2-5 |
| **Phase 7** | Polish & Production | Packaging, perf, a11y, docs | All phases |

Phases 2, 3, 4, and 5 can be built **in parallel** after Phase 1 completes.
