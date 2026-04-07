# Personal Assistant Surface — Product Requirements Document

## Overview

Add a **Personal Assistant** as a new surface in Quarry alongside the existing Chat, Cowork, Code, and Browser surfaces. The assistant surface is a persistent, autonomous coordination layer that monitors external sources, gathers context, executes scheduled tasks, and surfaces results as interactive A2UI cards — acting as a personal chief of staff for technical and semi-technical users.

The assistant surface **monitors and orchestrates** but delegates execution to the right surface. It does not replace Chat, Cowork, Code, or Browser — it coordinates across them.

---

## Problem Statement

Quarry's existing surfaces are reactive — they respond when the user initiates a conversation. There is no proactive layer that:

- Watches for events across connected systems (email, calendar, Slack, Jira, GitHub, builds)
- Runs autonomous tasks on a schedule or in response to triggers
- Tracks task state across executions (deduplication, progress, completion)
- Surfaces findings as actionable UI, not just text summaries
- Injects context from background monitoring into active work sessions

The heartbeat and cron systems exist but are disconnected from agent definitions, produce ephemeral text output, and have no lifecycle management.

---

## Target Users

A mix of technical to semi-technical users. The system must hide complexity by default while allowing full control for power users. Users should be able to create sophisticated automations through natural language without understanding cron syntax, agent configuration, or tool scoping.

---

## User Scenarios

| Scenario | What happens |
|---|---|
| Pre-meeting prep | Assistant checks calendar, finds upcoming meeting, researches attendees via email/Slack/Jira/Confluence, produces a meeting primer card 30 minutes before |
| Email monitoring | "Let me know when Sarah emails about the Q3 budget" — assistant polls email, alerts when condition is met, auto-completes the order |
| Stock tracking | "Track Apple stock price and tell me if it drops below $200" — polls hourly, alerts on threshold, cheap checks between changes |
| Competitor monitoring | "Watch Acme Corp and let me know when they launch their new product" — daily web search, diffs against previous findings, alerts on new information |
| Daily learning | "Give me a 5 minute lesson every day on something new in AI" — daily cron, tracks topics already covered, produces a lesson card |
| Build monitoring | "Watch my build and check back in 30 min — fix any deployment issues" — polls Buildkite, on failure injects context into the Code surface |
| To-do management | "Make me a to-do list for today" — agent asks what to include, produces an interactive A2UI card with reorderable, checkable items |
| Morning briefing | Scheduled daily briefing across all connected sources — email, calendar, Slack, Jira, GitHub — synthesised into a single card |

---

## Design Decisions

### Standing Orders as the Core Abstraction

Every scenario maps to a **Standing Order** — a persistent, stateful instruction with a trigger, accumulated context, and a completion condition. This replaces and unifies the existing heartbeat and cron systems.

A standing order is not a cron job (stateless, runs forever) and not a one-shot task (runs once, no state). It is:

- **Stateful** — accumulates context across executions (previous findings, topics covered, price history)
- **Completion-aware** — has an end condition ("when the PR is merged", "when the email arrives") and self-terminates
- **Safety-bounded** — has max executions and expiry to prevent runaway loops and unbounded cost

**Rationale:** Research across Lindy.ai, LangGraph, Battle Station, and other systems shows this is the abstraction that covers all use cases. Cron jobs are a subset (standing orders with no completion condition). One-shot tasks are a subset (standing orders with max_executions=1). Event watches are a subset (standing orders with a trigger condition). One primitive, many patterns.

### A2UI Cards as the Primary Output

The assistant surface is **card-first, not chat-first**. Agent output renders as structured, interactive A2UI cards rather than conversational text. Quarry's existing A2UI system (types.ts, renderer.tsx) already supports tables, charts, kanban, stats, forms, lists, progress bars, and markdown — but all components are currently read-only.

**Rationale:** Cards are scannable, actionable, and persistent. A meeting prep card with "View Full / Snooze / Dismiss" buttons is more useful than a wall of text in a chat thread. The to-do scenario specifically requires interactive, reorderable lists. Research confirms that product-grade agent UIs converge on structured data mapped to pre-built components (Vercel AI SDK pattern), not generative code.

### Agent Configuration via AGENTS.md

Standing orders specify an `agentName` from AGENTS.md. The agent config defines model, tools, system prompt, and capabilities. The standing order engine doesn't need to understand agent internals — it spawns the named agent and gets back results.

**Rationale:** AGENTS.md already exists in Quarry and supports model, allowedTools, systemPromptFile, and triggers. This avoids building a parallel agent configuration system. It also means users who already define agents for interactive use can reuse them for scheduled/autonomous work.

### Single Agent vs Orchestrator+Subagents — Agent's Choice

The framework does not prescribe whether an agent fans out to subagents or handles everything itself. The agent config determines this:

- **Quick checks** (stock price, build status): Single agent with targeted tools, fast and cheap
- **Deep research** (meeting prep, morning briefing): Orchestrator agent with `spawn_agent` in its allowedTools, fans out to specialised sub-researchers in parallel, synthesises results

**Rationale:** Battle Station uses single agents for everything (sequential tool calls). This works but is slow for multi-source research. Quarry's `spawn_agent` already returns results to the parent (unlike Battle Station's fire-and-forget delegate), making it suitable for fan-out patterns. The key improvement needed is parallel subagent execution.

### Two-Stage Trigger Engine

Triggers evaluate in two stages to minimise cost:

1. **Deterministic check** (no LLM cost): cron match, interval elapsed, webhook received, hash comparison against last snapshot
2. **Semantic evaluation** (LLM cost, only when needed): if there's a diff AND the order has a natural language condition, a focused LLM call evaluates whether the condition is met

**Rationale:** Research across Lindy, Zapier, and n8n converges on this pattern. "Watch my build" should cost nearly nothing between status changes — just a fetch + hash compare. The LLM only fires when something actually changed and needs semantic evaluation.

### Context Bus for Cross-Surface Communication

Background findings from standing orders can flow into other surfaces via a priority-based context bus:

- **P0 (urgent)**: Inject immediately into active surface (e.g., build failure → Code surface)
- **P1 (relevant)**: Queue for injection at next turn boundary
- **P2 (informational)**: Accumulate in assistant surface sidebar, user pulls when ready

**Rationale:** The "watch my build and fix deployment issues" scenario requires Agent A's output to flow into Agent B's active session. Neither Quarry nor Battle Station can do this today. The context bus is the missing connective tissue. Priority levels prevent low-value notifications from interrupting deep work.

### Progressive Disclosure UX

Three tiers of interaction, all reading/writing the same underlying StandingOrder object:

- **Tier 1 — Natural language** (default): User types "brief me before meetings". System decomposes into a standing order and shows a confirmation card.
- **Tier 2 — Structured config**: User clicks "Customise" to reveal editable form fields (trigger, interval, conditions, notifications, agent).
- **Tier 3 — Full control**: User clicks "Advanced" to see raw config, prompt editing, tool permissions, execution logs.

**Rationale:** Research across Lindy, Relevance AI, and Zapier shows template-first design with natural language customisation is the UX that works for semi-technical users. Power users need an escape hatch to full control. All three tiers must be bidirectional — edits at any tier propagate.

### Governance on Unattended Execution

Standing orders running autonomously (especially overnight or on schedule) require approval for write operations. The existing `canUseTool` hook is extended with a rule: background/scheduled executions require approval for write tools (send email, post to Slack, create calendar event). Interactive sessions stay permissive.

**Rationale:** Learned from Battle Station's governance model. An agent spawned by a cron job at 3am should not send emails without human approval. The approval cards appear in the assistant surface's card feed for the user to action.

---

## Technical Architecture

### Surface Architecture

The assistant surface is a peer to existing surfaces, using Quarry's existing surface abstraction:

```
surfaces/
  chat/        — conversational, ephemeral, lightweight
  cowork/      — collaborative work, canvas, file editing
  code/        — dev-focused, repo context, build tools
  browser/     — web navigation, scraping
  assistant/   — standing orders, monitoring, delegation, briefings  ← NEW
```

Each surface has its own config (allowedTools, systemPrompt, model), component, and session management. The assistant surface config includes tools for standing order management plus read access to all connected sources.

### Standing Order Schema

```typescript
interface StandingOrder {
  id: string;
  instruction: string;            // natural language description
  agentName?: string;             // from AGENTS.md — determines model, tools, prompt
  trigger: {
    type: 'cron' | 'interval' | 'event';
    expression?: string;          // cron ("0 9 * * 1-5") or interval ("5m", "1h")
    event?: string;               // event type ("email:received", "build:complete")
  };
  condition?: string;             // natural language or structured condition
  completionCondition?: string;   // "when the PR is merged", "when the email arrives"
  state: Record<string, any>;     // accumulated context across executions
  status: 'active' | 'paused' | 'completed' | 'expired';
  maxExecutions?: number;         // safety bound (default: unlimited for recurring)
  expiresAt?: number;             // hard expiry (default: 7 days for watch-type orders)
  notifyVia: 'assistant' | 'toast' | 'inject:surfaceId';
  lastResult?: string;            // summary from last execution
  lastSnapshotHash?: string;      // for change detection
  runCount: number;
  createdAt: number;
  updatedAt: number;
}
```

Stored in a Zustand store with persistence (`assistant-store.ts`), following the same pattern as `cron-store.ts` and `heartbeat-store.ts`.

### Trigger Engine

Runs on the existing Electron minute tick (`minute:tick` IPC event). On each tick:

```
for each active standing order:
  1. SCHEDULE CHECK (deterministic, no LLM cost)
     - cron: does expression match current time?
     - interval: has enough time elapsed since lastRun?
     - event: has a matching event arrived? (from webhooks or connector polling)
     - if no match → skip

  2. DATA FETCH (tool call, no LLM cost)
     - invoke the source via MCP connector or WebFetch
     - hash the result → compare to lastSnapshotHash
     - if unchanged → skip (standing order state not updated)

  3. CONDITION EVALUATION (LLM cost, only on diff)
     - if order has no condition → proceed (any change triggers)
     - if order has a condition → focused LLM call:
       "Given this change: {diff}, does this meet the condition: {condition}? Answer yes/no with reasoning."
     - if condition not met → update lastSnapshotHash, skip

  4. AGENT EXECUTION
     - spawn the named agent (or default assistant agent)
     - pass: instruction + accumulated state + fresh data
     - agent produces A2UI card(s) as output
     - store card(s) in assistant surface card feed

  5. STATE UPDATE
     - update state with extracted findings (not raw output)
     - update lastSnapshotHash, lastResult, runCount
     - evaluate completionCondition → if met, set status='completed'
     - check maxExecutions and expiresAt → expire if exceeded
```

### A2UI Extensions

New component types added to the existing A2UI type system:

```typescript
// New component types
interface ActionCardComponent {
  type: 'action-card';
  id: string;
  title: string;
  subtitle?: string;
  body?: string;                  // markdown content
  icon?: string;                  // emoji or icon name
  source?: string;                // "calendar", "email", "build", etc.
  timestamp?: number;
  actions: Array<{
    label: string;
    action: string;               // action identifier
    variant?: 'primary' | 'secondary' | 'destructive';
    payload?: Record<string, any>;
  }>;
}

interface ApprovalCardComponent {
  type: 'approval-card';
  id: string;
  title: string;
  description: string;
  details?: Record<string, string>; // key-value metadata
  standingOrderId: string;
  toolName: string;
  toolInput: Record<string, any>;
}

interface TodoComponent {
  type: 'todo';
  id: string;
  title?: string;
  date?: string;                  // "Today", "2026-04-01"
  items: Array<{
    id: string;
    text: string;
    checked: boolean;
    priority?: 'low' | 'medium' | 'high';
    time?: string;                // "9:00 AM", "2:00 PM"
    linkedOrderId?: string;       // link to a standing order
  }>;
  reorderable: boolean;
  addable: boolean;
}

interface TimelineComponent {
  type: 'timeline';
  id: string;
  title?: string;
  entries: Array<{
    id: string;
    timestamp: number;
    source: string;
    summary: string;
    status: 'success' | 'info' | 'warning' | 'error';
    expandable?: string;          // detailed content on expand
  }>;
}
```

### Interactive A2UI

The existing renderer is extended with an `onAction` callback that flows user interactions back to the system:

```typescript
interface A2UIInteraction {
  componentId: string;
  action: string;
  payload: Record<string, any>;
}

// Examples:
// Todo checkbox toggle:   { componentId: "todo-1", action: "toggle", payload: { itemId: "item-3", checked: true } }
// Todo reorder:           { componentId: "todo-1", action: "reorder", payload: { itemIds: ["item-2", "item-1", "item-3"] } }
// Todo add item:          { componentId: "todo-1", action: "add", payload: { text: "New task" } }
// Action card button:     { componentId: "prep-1", action: "fix-in-code", payload: { error: "TypeError in auth.ts:42" } }
// Approval:               { componentId: "approval-1", action: "approve", payload: {} }
// Form submit:            { componentId: "form-1", action: "submit", payload: { field1: "value1" } }
```

Interactions are routed based on type:
- **State mutations** (todo toggle, reorder): Update the card store directly, no agent call needed
- **Agent actions** (form submit, approval): Feed back as a tool result or new message to the agent
- **Cross-surface actions** ("Fix in Code"): Publish to context bus with target surface and payload

### Context Bus

A lightweight pub/sub system for cross-surface communication:

```typescript
interface ContextEvent {
  id: string;
  source: string;                 // "standing-order:{orderId}" or "assistant"
  priority: 'p0' | 'p1' | 'p2';
  targetSurface?: string;         // specific surface, or broadcast
  summary: string;
  payload?: Record<string, any>;  // structured data for the target
  timestamp: number;
  consumed: boolean;
}

// Context bus store (Zustand)
interface ContextBusState {
  events: ContextEvent[];
  publish: (event: Omit<ContextEvent, 'id' | 'timestamp' | 'consumed'>) => void;
  consume: (eventId: string) => void;
  getUnconsumed: (surface?: string) => ContextEvent[];
}
```

Surface integration:
- **Code surface**: Before each LLM call, drain P0/P1 events and prepend as system context: `"[Background: Your production build just failed with TypeError in auth.ts:42. The user asked the assistant to watch this build.]"`
- **Cowork surface**: Show P1 events as toast notifications, P2 as sidebar items
- **Assistant surface**: All events visible in the activity timeline

### Agent Configuration

Standing orders reference agents from AGENTS.md. Example configurations:

```yaml
---
agents:
  # Lightweight checker — single agent, fast, cheap
  - name: quick-checker
    description: Lightweight monitoring and status checks
    model: claude-haiku-4-5
    allowedTools: [WebFetch, WebSearch, Read]

  # Meeting prep — orchestrator with subagent fan-out
  - name: meeting-prep
    description: Deep meeting preparation with multi-source research
    model: claude-sonnet-4-6
    systemPromptFile: ~/.claude/agents/meeting-prep.md
    allowedTools: [spawn_agent, WebSearch, Read]

  # Morning briefing — multi-source orchestrator
  - name: morning-briefing
    description: Daily briefing across all connected sources
    model: claude-sonnet-4-6
    systemPromptFile: ~/.claude/agents/briefing.md
    allowedTools: [spawn_agent, Read]

  # Source-specific researchers (used as subagents)
  - name: email-researcher
    description: Search and summarise email threads
    model: claude-haiku-4-5
    allowedTools: [Read]
    # MCP connectors: gmail or apple-mail

  - name: slack-researcher
    description: Search Slack channels and threads
    model: claude-haiku-4-5
    allowedTools: [Read]
    # MCP connectors: slack

  - name: jira-researcher
    description: Query Jira issues and project status
    model: claude-haiku-4-5
    allowedTools: [Read]
    # MCP connectors: jira
---
```

The framework does not prescribe single-agent vs orchestrator+subagent. The agent's `allowedTools` determines whether it can fan out. Agents without `spawn_agent` handle everything sequentially. Agents with `spawn_agent` can orchestrate parallel subagent research.

**Parallel subagent execution**: The current `spawn_agent` implementation awaits each subagent sequentially. For the orchestrator pattern to be fast, the subagent API must support parallel execution — fire off N subagents concurrently and collect all results. This requires a change to the subagent route to accept batch requests or the provider to handle concurrent `spawn_agent` tool calls.

### Standing Order Tools (MCP)

Tools available to the assistant surface agent for managing standing orders:

```typescript
// In-process MCP tools (like CronCreate)
const assistantMcpTools = [
  {
    name: 'create_standing_order',
    description: 'Create a new standing order for autonomous monitoring or scheduled tasks',
    inputSchema: {
      instruction: 'string',      // what to do
      trigger: 'object',          // when to do it
      condition: 'string?',       // only act when...
      completionCondition: 'string?',
      agentName: 'string?',       // which agent runs it
      notifyVia: 'string?',
    }
  },
  {
    name: 'list_standing_orders',
    description: 'List all standing orders and their current status',
    inputSchema: { status: 'string?' }
  },
  {
    name: 'update_standing_order',
    description: 'Update a standing order (pause, resume, modify)',
    inputSchema: { id: 'string', updates: 'object' }
  },
  {
    name: 'cancel_standing_order',
    description: 'Cancel and remove a standing order',
    inputSchema: { id: 'string' }
  },
  {
    name: 'get_standing_order_history',
    description: 'Get execution history and accumulated state for a standing order',
    inputSchema: { id: 'string' }
  },
]
```

### Template System

Pre-built standing order configurations that users can activate with one click or customise:

```typescript
interface StandingOrderTemplate {
  id: string;
  name: string;                   // "Morning Briefing"
  description: string;            // "Daily summary across all connected sources"
  icon: string;
  category: 'productivity' | 'monitoring' | 'research' | 'learning';
  order: Partial<StandingOrder>;  // pre-filled fields
  requiredConnectors: string[];   // ["gmail", "slack"] — shown as prerequisites
  parameters: Array<{             // user-fillable slots
    name: string;
    label: string;
    type: 'text' | 'select' | 'time' | 'number';
    placeholder?: string;
    options?: string[];
    defaultValue?: string;
  }>;
}
```

Built-in templates:

| Template | Trigger | Agent | Description |
|---|---|---|---|
| Morning Briefing | Daily at configured time | morning-briefing | Multi-source daily summary |
| Meeting Prep | 30min before calendar events | meeting-prep | Context gathering from email, Slack, Jira |
| PR Watcher | Every 5min | quick-checker | Monitor a PR for reviews, CI status, merge |
| Build Watcher | Every 2min | quick-checker | Monitor a build, alert on failure |
| Email Alert | Every 5min | quick-checker | Watch for email matching criteria |
| Competitor Monitor | Daily | quick-checker | Web search for competitor news, diff against previous |
| Daily Lesson | Daily at configured time | quick-checker | Teach something new on a chosen topic |
| Stock Tracker | Hourly | quick-checker | Track price, alert on threshold |

---

## Assistant Surface Layout

```
┌──────────────────────────────────────────────────────────┐
│  Personal Assistant                                [··]  │
├──────────────────────────────────────────────────────────┤
│  🔍 "Watch my Buildkite build and let me know if..."    │
├───────────────┬──────────────────────────────────────────┤
│               │                                          │
│  STANDING     │   CARD FEED (newest first)               │
│  ORDERS       │                                          │
│               │  ┌─ action-card ──────────────────────┐  │
│  ● Meeting    │  │ 📅 Sprint Planning @ 2:00pm        │  │
│    prep       │  │ Attendees: Sarah, Mike, Jo          │  │
│  ● Build      │  │ Key topics: PROJ-123 blocked,       │  │
│    #4521      │  │ sprint velocity down 20%            │  │
│  ● Stock      │  │                                     │  │
│    AAPL       │  │ [View Full Prep]  [Dismiss]         │  │
│  ○ Competitor │  └────────────────────────────────────┘  │
│    watch      │                                          │
│  ○ Daily AI   │  ┌─ approval-card ────────────────────┐  │
│    lesson     │  │ ⚠ Agent wants to send email         │  │
│               │  │ To: sarah@company.com               │  │
│  ● = ran      │  │ Subject: "Sprint planning agenda"   │  │
│    recently   │  │                                     │  │
│  ○ = idle     │  │ [Approve]  [Reject]  [Edit]        │  │
│               │  └────────────────────────────────────┘  │
│  ─────────    │                                          │
│  TEMPLATES    │  ┌─ todo ─────────────────────────────┐  │
│               │  │ Today's Plan — 1 Apr 2026           │  │
│  + Morning    │  │ ☑ Review PR #892                    │  │
│    briefing   │  │ ☐ Meeting prep for 2pm              │  │
│  + PR         │  │ ☐ Build & release v2.1              │  │
│    watcher    │  │ ☐ Write design doc for Q3           │  │
│  + Build      │  │                                     │  │
│    monitor    │  │ [+ Add item]        [↕ Reorder]    │  │
│  + More...    │  └────────────────────────────────────┘  │
│               │                                          │
│               │  ┌─ timeline ─────────────────────────┐  │
│               │  │ Activity Log                        │  │
│               │  │ 09:01 ✓ Morning briefing complete   │  │
│               │  │ 08:45 ✓ Email check — nothing new   │  │
│               │  │ 08:30 ⚠ Build #4520 failed         │  │
│               │  │ 08:00 ✓ Stock check — AAPL $198     │  │
│               │  └────────────────────────────────────┘  │
│               │                                          │
├───────────────┴──────────────────────────────────────────┤
│  3 orders ran today · 1 needs attention · next: 1:30pm   │
└──────────────────────────────────────────────────────────┘
```

The natural language input at the top handles both standing order creation ("watch my build") and direct questions ("what's on my calendar today?"). The assistant surface agent decomposes input and decides whether to create a standing order, answer directly, or produce an A2UI card.

---

## Build Phases

### Phase 1 — Interactive A2UI (Foundation)

**Goal:** Make the existing A2UI system interactive so cards can capture user input.

- Add `onAction` callback prop to `A2UIDocumentRenderer`
- Make list checkboxes toggleable with state mutation
- Enable form submission with value collection
- Add `action-card` component type with clickable buttons
- Add `todo` component type with check/uncheck and drag-to-reorder
- Add `approval-card` component type with approve/reject actions
- Add `timeline` component type for activity logs
- Route interactions: state mutations update store directly, agent actions feed back as messages

### Phase 2 — Assistant Surface (Container)

**Goal:** Create the assistant surface as a new peer surface with card-feed layout.

- New `assistant-config.ts` surface config with assistant-specific tools and system prompt
- New `assistant-surface.tsx` component — card feed layout (not chat-first)
- Standing order store (`assistant-store.ts`) — Zustand with persistence
- Left sidebar: active standing orders list with status indicators + template gallery
- Main area: A2UI card feed, newest at top, grouped by time
- Status bar: order count, pending actions, next scheduled run
- Wire up in `app-shell.tsx` as fifth surface tab
- Natural language input at top for creating orders and asking questions

### Phase 3 — Standing Order Engine (Brain)

**Goal:** Standing orders trigger, evaluate, execute, and manage their own lifecycle.

- Standing order CRUD via in-process MCP tools (create, list, update, cancel, history)
- Trigger engine on existing minute tick: cron match → data fetch → diff → condition eval → agent run
- `agentName` on orders — spawn named agents from AGENTS.md
- Agent output stored as A2UI cards in the assistant card feed store
- State extraction after each execution (compact findings, not raw output)
- Completion condition evaluation and auto-termination
- Safety bounds: maxExecutions, expiresAt, cost tracking

#### Cron and Heartbeat Migration

Standing orders subsume the existing cron and heartbeat systems. Both are replaced, not extended.

**What changes in the cron system:**

| File | Change |
|---|---|
| `stores/cron-store.ts` | **Deprecated.** CronJob entries migrated to StandingOrder on first load. Store kept read-only during transition for backwards compat, then removed. `matchesCron()` utility function extracted and reused by the standing order trigger engine. |
| `hooks/use-cron.ts` | **Replaced.** The minute-tick evaluation loop moves into the standing order trigger engine. `useCron` hook removed once migration is complete. |
| `app/api/cron/route.ts` | **Replaced.** Server-side cron validation moves to the standing order creation API. Route kept as a thin redirect during transition. |
| `claude-provider.ts` — `CronCreate` MCP tool | **Replaced by `create_standing_order`.** CronCreate calls are intercepted and mapped to standing order creation with `trigger.type='cron'`, no completion condition, and no state. Existing agent prompts that output `QUARRY_CRON:` strings are handled the same way — the cowork surface parser maps them to `create_standing_order` calls. |
| `cowork-surface.tsx` — `QUARRY_CRON:` regex parser | **Updated** to create standing orders instead of cron jobs. |

**Migration mapping — CronJob to StandingOrder:**

```typescript
// Automatic migration on first load
function migrateCronJob(job: CronJob): StandingOrder {
  return {
    id: job.id,                         // preserve ID
    instruction: job.prompt,
    agentName: undefined,               // cron jobs had no agent config
    trigger: { type: 'cron', expression: job.expression },
    condition: undefined,               // cron jobs had no conditions
    completionCondition: undefined,     // cron jobs run indefinitely
    state: {},
    status: job.enabled ? 'active' : 'paused',
    maxExecutions: undefined,
    expiresAt: undefined,
    notifyVia: 'assistant',
    lastResult: undefined,
    lastSnapshotHash: undefined,
    runCount: 0,
    createdAt: job.createdAt,
    updatedAt: Date.now(),
  };
}
```

**What changes in the heartbeat system:**

| File | Change |
|---|---|
| `stores/heartbeat-store.ts` | **Deprecated.** Heartbeat entries become standing order results stored in the assistant card feed. The 30-day auto-prune logic moves to the assistant store. |
| `hooks/use-heartbeat.ts` | **Replaced.** The three heartbeat modes (morning, evening, idle) become pre-installed standing order templates. The minute-tick listener, idle timer, and fired-today tracking all move into the standing order trigger engine. |
| `components/layout/heartbeat-panel.tsx` | **Replaced** by the assistant surface's card feed and timeline. Heartbeat entries that were displayed in the side sheet now appear as timeline entries or A2UI cards in the assistant surface. |
| `components/customize/automation-section.tsx` | **Updated.** The ModeCard UI for configuring morning/evening/idle modes is replaced by the assistant surface's standing order list and template gallery. The cron job panel (CronPanel) is replaced by standing order management. |
| `stores/settings-store.ts` — `HeartbeatModes` | **Deprecated.** Morning/evening times and connector selection move into standing order template parameters. Idle timeout moves into a standing order with `trigger.type='interval'`. |

**Migration mapping — Heartbeat modes to StandingOrders:**

| Heartbeat Mode | Standing Order Equivalent |
|---|---|
| Morning briefing (enabled, time: "09:00", connectors: ["github", "slack"]) | `{ instruction: "Morning briefing across github, slack", trigger: { type: 'cron', expression: '0 9 * * *' }, agentName: 'morning-briefing', notifyVia: 'assistant' }` |
| Evening wrap-up (enabled, time: "17:30", connectors: ["github", "jira"]) | `{ instruction: "Evening summary of today's activity across github, jira", trigger: { type: 'cron', expression: '30 17 * * *' }, agentName: 'morning-briefing', notifyVia: 'assistant' }` |
| Idle nudge (enabled, idleMinutes: 15) | `{ instruction: "Check for anything that needs attention", trigger: { type: 'interval', expression: '15m' }, condition: 'Only surface if there is something actionable', notifyVia: 'assistant' }` |

**Cowork surface changes:**

| Location in `cowork-surface.tsx` | Change |
|---|---|
| `fireBackgroundRun()` (~line 1062) | **Retained** but called by standing order engine instead of directly by `useCron`. |
| `runSilentHeartbeat()` (~line 1088) | **Removed.** Heartbeat results now go through standing order execution → assistant card feed, not a throwaway chat API call. |
| `useHeartbeat(runSilentHeartbeat)` (~line 1136) | **Removed.** Standing order trigger engine handles all scheduling. |
| `useCron((job) => { ... })` (~line 1138) | **Removed.** Standing order trigger engine handles cron evaluation. |
| `QUARRY_CRON:` regex parser (~line 660) | **Updated** to call `create_standing_order` instead of `addJob`. |

**Transition strategy:**

1. Phase 2 (assistant surface) launches with standing orders running alongside cron/heartbeat — no migration yet
2. Phase 3 adds the migration function that runs on first load: reads cron-store and heartbeat settings, creates equivalent standing orders, marks originals as migrated
3. Cron and heartbeat systems enter read-only mode — existing entries visible but no new ones created
4. Phase 5 removes deprecated stores, hooks, and components entirely

**What is preserved:**
- `matchesCron()` from `cron-store.ts` — extracted as a shared utility, reused by standing order trigger engine
- The minute tick from Electron (`main-web.js` line 496) — this is the clock source for the standing order engine, unchanged
- `fireBackgroundRun()` pattern — standing orders use the same mechanism to spawn agent runs on the cowork surface when needed

### Phase 4 — Context Bus (Cross-Surface Communication)

**Goal:** Background findings flow into active sessions based on priority.

- Context bus Zustand store with pub/sub semantics
- Standing order results publish events with priority (P0/P1/P2)
- Code surface: drain P0/P1 events before each LLM call, prepend as context
- Cowork surface: P1 as toast notifications, P2 as sidebar items
- Assistant surface: all events visible in timeline
- "Fix in Code" / "Open in Cowork" actions on cards that navigate to target surface with context injected
- Notification badge on assistant tab for unread P0/P1 events

### Phase 5 — Polish and Power Features

**Goal:** Template gallery, progressive disclosure, and refinements.

- Template gallery with built-in templates (morning briefing, PR watcher, meeting prep, etc.)
- Progressive disclosure: natural language confirmation cards → structured form → raw config editor
- Natural language decomposition pipeline: intent extraction → source resolution → schedule inference → condition compilation
- Parallel subagent execution for orchestrator agents (batch spawn_agent support)
- Standing order state memory extraction (LLM summarises what's worth remembering after each run)
- Governance: `canUseTool` rule for unattended write operations requiring approval
- Execution cost tracking and display per standing order
- Import/export standing orders as YAML for sharing

---

## Dependencies

| Dependency | Status | Notes |
|---|---|---|
| A2UI type system + renderer | Exists | `lib/a2ui/types.ts`, `lib/a2ui/renderer.tsx` — needs interactivity |
| Surface abstraction | Exists | Surface configs, components, routing all established |
| Minute tick from Electron | Exists | `main-web.js` sends `minute:tick` IPC every 60s |
| AGENTS.md parser | Exists | `lib/agents-parser.ts` — loads global and workspace agents |
| Subagent API | Exists | `api/subagent/route.ts` — needs parallel execution support |
| `canUseTool` hook | Exists | `claude-provider.ts` — needs governance rule for background runs |
| Zustand stores with persistence | Exists | Pattern established by `cron-store.ts`, `heartbeat-store.ts` |
| MCP connectors (Gmail, Slack, Jira, GitHub) | Exists | Available as connected MCP servers |
| `spawn_agent` tool | Exists | Returns results to parent — needs batch/parallel support |
| Cron expression matching | Exists | `cron-store.ts` `matchesCron()` function |

---

## Open Questions

1. ~~**Heartbeat/cron migration**~~: Resolved — both systems are fully replaced by standing orders. See Phase 3 migration plan for file-by-file changes and transition strategy.
2. ~~**Cost management**~~: Deferred — out of scope for initial build. Will revisit when usage patterns are clearer.
3. ~~**Multi-user**~~: Resolved — standing orders are per-user. Shared orders can be revisited later.
4. ~~**Offline behaviour**~~: Resolved — on app restart, the trigger engine evaluates all active standing orders and catches up on any missed triggers. Orders with `trigger.type='cron'` that missed their window execute once immediately (not once per missed tick). Orders with `trigger.type='interval'` reset their interval from the restart time.
5. ~~**Template distribution**~~: Resolved — templates are bundled with the app for the initial build. A template registry for community/shared templates will be explored in a future phase.
6. ~~**State size limits**~~: Resolved — standing order state is capped at 50KB. When state exceeds the cap, the next execution's state extraction step receives an additional instruction to summarise and consolidate, keeping only what's still relevant. This is self-healing — the agent compacts its own state as part of normal operation. Execution history (raw logs) is separate from state and uses a rolling window of the last 30 runs.

---

## Success Criteria

- User can create a standing order via natural language and see it running within 60 seconds
- Meeting prep card appears automatically before meetings with relevant context from connected sources
- Build monitoring detects failure and injects context into Code surface without user intervention
- To-do cards are interactive — items can be checked, reordered, and added without re-prompting the agent
- Standing orders self-terminate when their completion condition is met
- Unattended write operations surface approval cards, not silent execution
- Semi-technical users can set up automations without seeing cron syntax, JSON, or agent configuration

---

## References

- **Battle Station AI** — Multi-agent orchestration with work item lifecycle, governance, tool scoping, and delegation patterns. Key learnings: DB-mediated coordination, source deduplication via watermarks, baseline vs elevated tool permissions.
- **Lindy.ai** — Standing agent configurations with triggers, persistent execution history, sub-Lindy composition.
- **LangGraph** — Graph-based orchestration with checkpointed state, Store API for shared memory, interrupt() for human-in-the-loop.
- **Vercel AI SDK** — Generative UI pattern: tools return structured data mapped to pre-built React components, interaction closure via tool results.
- **Zapier AI Agents** — Natural language trigger refinement compiled to hybrid filters (deterministic + semantic).
- **Quarry existing systems** — A2UI renderer, cron-store, heartbeat, AGENTS.md, spawn_agent, canUseTool, surface abstraction.
