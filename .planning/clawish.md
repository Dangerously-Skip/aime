# DR-1 RESOLVED — "Clawish" is a runtime, not a surface

> Owner intent (2026-07-25): *"openClaw style functionality… I am also very
> interested in the goal based / outcome based functionality of a tool like
> openworker."*

**Decision: Clawish is not a fifth surface.** It is two orthogonal capabilities
that the current architecture lacks:

1. **An always-on, event-driven runtime** (the OpenClaw idea)
2. **Goal/outcome jobs with approval gates** (the openworker idea)

Both are *cross-surface*. Adding a tab would be the wrong shape — you cannot
"navigate to" an always-on agent.

## What actually makes OpenClaw different from a chat agent

Not the model, not the prompt, not the tools. **The trigger surface.** A chat
agent has exactly one input vector: a human types. OpenClaw has five, and they
all feed the *same* turn loop:

| Vector | Trigger |
|---|---|
| Messages | human, via WhatsApp/Telegram/Slack/Discord/iMessage |
| Heartbeat | time (default 30 min) — "check if there's anything to do" |
| Webhooks | external systems |
| Hooks | internal automation discovered from the workspace |
| Scheduled events | cron-like |

Supporting structure a chat app doesn't have:

- **Gateway daemon** — a long-running process that is the control plane and
  source of truth; the UI is a *client* of it, not the host of it.
- **Disk-backed session store** (JSONL transcripts) — durability across
  restarts. State lives on disk, not in a renderer's memory.
- **Lane-aware FIFO queue** — one active run per session, parallel across
  sessions.
- **Session isolation** — DM context vs channel context never leak.

The insight worth stealing: *"a timer created an event at 3:00 AM, and the agent
ran a normal turn."* Autonomy is not a special agent mode — it's **ordinary
turns triggered by non-human events**. Agents as event-driven state machines
with disk-backed memory.

## What openworker adds: outcomes, not messages

openworker's framing is that the deliverable — not the reply — is the unit of
work. *"prepare a customer brief," "untangle my calendar," "draft a report."*
The user declares an **outcome**; the agent decomposes, executes across files
and apps, and hands back finished work.

Its distinctive architectural move is the **approval gate**: before
*consequential* actions (sending a message, changing a calendar, running a
command) it pauses for confirmation. That's what makes unattended execution
tolerable. Notably it does *not* appear to have a formal success-verification or
retry layer — approval is the accountability mechanism. **We should go further
here** (see below); it's the weakest part of that design and the most valuable
thing to add.

## What AIME already has (more than expected)

This is not a greenfield build. Existing, tested machinery:

- **Minute tick** — Electron main → `minute:tick` IPC → `onMinuteTick`; hooks
  already subscribe for cron, heartbeat, session reset. *This is a heartbeat.*
- **`cron-store` + `matchesCron()`** — cron evaluation on heartbeat, tested.
- **Webhooks** — `GET|POST|DELETE /api/webhooks` + `POST /api/webhooks/[token]`,
  CRUD and trigger both tested.
- **Standing orders** — `standing-order-engine.ts` + templates + import, tested.
  This is the closest thing to a goal object today.
- **Subagents** — `POST /api/subagent` + `/batch`, `spawn_agent` interception.
- **Heartbeat modes** in settings (`heartbeatModes`, `DEFAULT_HEARTBEAT_MODES`).

**The gap is not triggers — it's the job model and the runtime's location.**

## The two real gaps

### Gap 1: everything is renderer-hosted

Triggers fire from a React hook on a minute tick. Close the window and nothing
runs. OpenClaw's gateway is a daemon; AIME's "runtime" is a component tree.
Making work survive a closed window means moving the loop into Electron main (or
a spawned service) with a disk-backed queue — a real architectural change, and
the honest prerequisite for "does work while you are asleep."

### Gap 2: no goal/outcome object

A standing order is a *prompt on a schedule*. A goal is a **desired end state
with a completion test**. Missing:

- `Goal { objective, successCriteria, constraints, approvalPolicy, deliverable }`
- A **verification step** — did the outcome actually happen? (openworker's hole)
- **Retry/escalation** on failure (tumble the tier up? ask the human?)
- **Approval gates** on consequential actions — AIME has `canUseTool`
  governance + a pending-questions bridge, so the *mechanism* exists; the
  *policy* ("what counts as consequential") does not.
- **A durable run record** — what ran, what it produced, did it succeed.

## Proposed slicing (post-P2)

- **C1 — Goal/outcome model.** `Goal` type + a `goals` store + completion
  criteria; standing orders become one way to *trigger* a goal. Pure + testable,
  no runtime move required.
- **C2 — Run records.** Durable `{goalId, status, startedAt, durationMs, error,
  tokens, toolCalls, deliverable}` for every triggered run. **This is also
  exactly what Cockpit needs to display** (see `cockpit.md`) — build once.
- **C3 — Approval policy.** Classify consequential tool calls; gate them through
  the existing `canUseTool` + pending-questions path.
- **C4 — Verification + retry.** A post-run check against `successCriteria`;
  escalate (retry, tier-up, or ask the human) on failure. This is where we beat
  openworker.
- **C5 — Move the loop out of the renderer.** Electron-main-hosted scheduler
  with a disk-backed queue, so runs survive a closed window. Largest change;
  do it once C1–C4 prove the model.
- **C6 (optional) — External channels.** Only if "reachable from WhatsApp/
  Telegram" is genuinely wanted; it implies inbound networking and a real
  auth story. Defer until asked for.

Sequencing note: C1+C2 are worth doing regardless — they're the shared substrate
under both Clawish and Cockpit.

## Sources

- OpenClaw: <https://github.com/openclaw/openclaw>, <https://docs.openclaw.ai/>,
  architecture write-up:
  <https://theagentstack.substack.com/p/openclaw-architecture-part-1-control>
- openworker: <https://github.com/andrewyng/openworker>
