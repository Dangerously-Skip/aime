# Long-running harness loops — implementation plan

**Surfaces:** Cowork and Code. **Status:** planned, not started.
Research and sources: see the "Background" section at the end.

## What this adds

A per-conversation mode toggle. In **Chat** mode a surface behaves as it does
today: one user message, one turn, stop. In **Goal** mode the surface pursues an
objective across many sessions — planning, researching, executing, verifying and
re-planning — and comes back to the user only when it has to.

The distinction that shapes everything below: the human in the outer loop does
**two** jobs, deciding what is next *and* verifying what just happened.
Automating only the first produces a loop that ships wrong work confidently and
faster than a human ever could. We have already seen the failure in this repo —
a deck agent reported "all 9 videos are properly embedded" when every one of
them was broken. An outer loop without a verifier would have built nine more
sessions on top of that.

## Three loops, and which ones already exist

| Loop | What it does | Today |
|---|---|---|
| Inner | ReAct: reason → tool → observe | Agent SDK. Untouched by this plan. |
| Session (harness) | Keeps ONE run coherent: tools, state, recovery | `route.ts` + resume loop. Largely built. |
| Outer | Verify, decide next, start another run | **Does not exist.** This plan. |

### What we can build on

- **`lib/pending-questions.ts`** — `AskUserQuestion` already parks a promise in a
  rendezvous, and already distinguishes "expired" from "declined". The hard part
  of a human gate is done. (Caveat in Phase 3 — its semantics are wrong for
  unattended runs.)
- **The resume loop** (`app/api/chat/[surfaceId]/route.ts`, ~line 1044) —
  `MAX_RESUMES = 3` gated on remaining budget, wall clock, resume cap and
  `!req.signal.aborted`. This is one turn of an outer loop, with the disconnect
  and timer-rearm hazards already found and commented. **The outer loop should
  reuse these guards rather than reinvent them.**
- **`lib/surfaces/shared/limits.ts`** — `TURN_BACKSTOP.unattended = 30` exists,
  as does the written argument for why a turn count is a poor governor and why a
  context-derived cap is worse. That reasoning transfers to outer-loop stops.
- **`maxBudgetUsd`** is enforced now, so there is real spend authority to hang
  stop conditions off.
- **`~/<DATA_DIR>/scratch/{conversationId}/`** (`hooks/use-scratch-dir.ts`) —
  a durable per-conversation directory already exists.
- **`/api/subagent`** — where the verifier runs.

### What is missing

No plan/task ledger (`cowork-store` has no plan state at all), **no verifier**,
no cross-session continuity (the resume loop lives and dies inside one HTTP
request), and no no-progress detector.

---

## Artifacts

Modelled on Anthropic's harness, which is the only published design with a
worked long-running example.

**Location.** When the surface has a working folder, `<folder>/.aime/`. Without
one, the scratch dir. In the folder is the better default: the agent finds it
with `Glob` without being told, it survives across conversations on the same
project, and it shows up in a diff where the user can read it. Cost: we write a
directory into the user's repo, so Phase 0 also appends `.aime/` to
`.gitignore` if one exists and the entry is absent.

```
.aime/
  goal.json        the objective + acceptance criteria. AGENT MAY NOT EDIT.
  tasks.json       the ledger. Agent may flip `status` and nothing else.
  progress.md      human-readable, appended once per session.
  runs/<n>.json    per-session record: what ran, what it cost, what changed.
```

**`goal.json`** is written once, from the user's prompt, by an initializer
session. It holds the objective, explicit acceptance criteria, and the stop
budget. The agent is denied write access to it — an agent that can edit the goal
does not have a goal.

**`tasks.json`** is the `features.json` analogue:

```jsonc
{
  "version": 1,
  "tasks": [
    {
      "id": "t-014",                     // stable; never reused
      "title": "Deck opens over http and every embed plays",
      "verify": ["open the preview URL", "each iframe reports readyState"],
      "status": "todo",                  // todo | doing | passed | blocked
      "attempts": 0,
      "lastVerdict": null
    }
  ]
}
```

JSON rather than Markdown deliberately: models are measurably less willing to
overwrite a JSON file wholesale. The rule that makes the ledger worth having is
that **an execution session may write only `status`, `attempts` and
`lastVerdict`**. Adding, removing or rewording a task is a *plan revision*, which
is a separate step with its own record (Phase 4). Devin's team put it well —
"the plan changes a lot over time; this isn't a failure mode, it's the design" —
but a revision that happens silently mid-execution is indistinguishable from an
agent editing away work it found hard.

---

## The outer loop

**Where it runs.** Server-side, in the Next process, as a background task keyed
by conversation id — not in the renderer. A renderer loop dies when the user
switches surface or closes the window, which is precisely when a long run is
most valuable. State lives on disk, so an app restart resumes rather than loses.

```
lib/harness/
  ledger.ts         read/write/validate goal.json + tasks.json + progress.md
  goal-loop.ts      the outer loop itself
  stop.ts           stop conditions, with authority
  verifier.ts       maker-checker gate
  events.ts         SSE chunk types for the panel
app/api/harness/
  route.ts          POST start | GET status | DELETE stop
```

One session of the loop:

```
  read ledger + progress + git log
  pick the ONE highest-priority task with status todo        ← one at a time
  run an execution session  (existing /api/chat machinery, unchanged)
  run the VERIFIER against that task's `verify` steps
    pass  → status = passed, commit, append progress
    fail  → attempts++, re-prompt with the exact missing requirements
  check stop conditions
  repeat
```

"One task at a time" is load-bearing rather than tidiness — it is what stops the
model attempting everything and declaring victory.

### Stop conditions (`stop.ts`)

Each has **authority to halt**, not just to render. The cautionary tale from the
research is an agent that retried 240 times over three hours for $4,200 while
"three monitoring dashboards displayed the spend in real time; none of them had
the authority to stop it."

| Condition | Trigger |
|---|---|
| Budget | cumulative spend ≥ goal budget (reuses `effectiveBudgetUsd`) |
| Wall clock | elapsed ≥ goal deadline |
| Session cap | sessions ≥ cap |
| **No progress** | N consecutive sessions with no change to the ledger state hash |
| Stuck task | one task fails verification `attempts` ≥ cap |
| User | explicit stop, or `req.signal.aborted` semantics as today |

No-progress is the one that would have caught the two agents that sat in a
mutual clarification loop for eleven days and $47,000. It is cheap: hash the
`(id, status)` pairs and compare.

### The verifier (`verifier.ts`)

A subagent via `/api/subagent` with its own surface config, and the design
constraint that makes maker-checker real: **the verifier must not be able to fix
anything.** A checker that can edit becomes a second maker and the split
collapses.

- `deniedTools: ['Write', 'Edit', 'NotebookEdit', 'ExcelWrite', 'ExcelEdit']`.
  `deniedTools`, not a narrowed `allowedTools` — this repo has already shipped
  four security toggles that filtered an auto-approve list and enforced nothing.
- **`Bash` stays allowed**, because running the tests is the job. That is a real
  hole: Bash can write. It is closed by rule rather than by permission —
  **the verifier's verdict is discarded if the working tree changed while it
  ran.** Snapshot `git status --porcelain` before and after; a difference means
  the verifier edited something, which invalidates it as a verifier.
- Returns a structured verdict: `{ passed, missing[], evidence[] }`. On failure
  the next execution session is re-prompted with `missing` verbatim.

Anthropic's biggest observed failure was that the agent "made code changes but
would fail to recognise the feature didn't work end-to-end", and the fix was
tooling plus *explicit* instruction to test. The verifier's prompt must demand
evidence — a command and its output, a fetched URL and its status — not an
assurance.

---

## Surfaces

Shared engine, one shared panel, two mounts.

**`components/harness/goal-panel.tsx`** — goal and acceptance criteria, the task
ledger with status, the progress log, current session and what it is doing,
cumulative spend against budget, and a stop button that actually stops.

- **Cowork** — a panel alongside Context/Artifacts, and the natural home for the
  toggle since Cowork is already the goal-shaped surface.
- **Code** — a `Goal` tab in the existing right-hand dock beside Files/Editor.
  Code benefits most from the verifier, because tests are a real gate here.

Surface configs gain nothing structurally: `SurfaceConfig` already carries
`maxTurns`, `maxBudgetUsd` and `queryTimeoutSecs`, and `TURN_BACKSTOP.unattended`
is the right per-session ceiling for a goal run.

The **progress log is the antidote to comprehension debt** — the research's name
for the gap that opens between what exists and what the user understands when a
loop produces changes they did not make by hand. It is a UI feature, not a log
file.

---

## Phases

Each phase is shippable and testable on its own.

**Phase 0 — Ledger.** `ledger.ts`, the schemas, atomic writes, the
write-restriction rule, `.gitignore` handling. No loop, no UI.
*Tests:* unit for schema and state hashing; integration against a real temp
directory for read/modify/write and concurrent-write safety; a test that a
session-shaped write touching anything but `status`/`attempts`/`lastVerdict` is
rejected.

**Phase 1 — Outer loop without a verifier.** `goal-loop.ts`, `stop.ts`, the
route, the panel read-only. Sessions run until the ledger is clear or a stop
condition trips.
*Tests:* the loop driven with a faked session runner — real ledger, real stop
logic, only the model call stubbed. **Every stop condition sabotage-verified**:
disable it, confirm a named test fails. A stop condition with no failing test is
not a stop condition, which is the whole lesson of the $4,200 run.

**Phase 2 — Verifier.** `verifier.ts`, the read-only subagent config, the
tree-unchanged rule, re-prompt-on-failure.
*Tests:* a real subagent config asserting `deniedTools` covers every write tool
derived from source rather than hand-listed; an integration test that a verifier
which writes has its verdict discarded; sabotage the tree-unchanged check and
confirm failure.

**Phase 3 — Durable escalation.** This needs new machinery, not a reuse.
`pending-questions.ts` has a **five-minute timeout and silence rejects**, which
is correct for an interactive turn and wrong for a run that continues while the
user sleeps. Goal mode needs a question that **parks**: persist it, halt the
loop, notify (the Electron notification path already exists), resume on answer.
*Tests:* a parked question survives a process restart; a parked question does not
expire; answering resumes the loop at the right task.

**Phase 4 — Plan revision.** The agent proposes ledger changes as an explicit
diff with a rationale, recorded in `runs/<n>.json`. Additions may be automatic;
deletions and reworded acceptance criteria require the Phase 3 gate.

---

## Risks

- **Lifecycle.** The loop must survive surface navigation and app restart. State
  on disk is the answer; the per-surface stream ownership work (`ownStreamsRef`)
  already stops one surface's stream leaking into another's.
- **Cost.** An automated loop "burns tokens whether or not it finds much."
  Budget is a stop condition and the panel shows spend continuously; goal mode is
  off by default.
- **Weak verification is worse than none.** If the verifier rubber-stamps, the
  loop ships confident garbage faster than a human could. Phase 2 must not merge
  on a green suite alone — it needs a deliberately-broken task that the verifier
  is required to catch.
- **Reward hacking.** An agent optimising `passes` rather than the goal is the
  reason the ledger write-restriction and the read-only verifier are both rules
  rather than conventions.

---

## Background

Field research, August 2026. Three nested loops (inner / harness / outer);
`Agent = Model + Harness`; harness engineering targets the inner loop and **loop
engineering** the outer.

- [Effective harnesses for long-running agents — Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  — the initializer/coding split, `features.json` (200+ entries, `passes` only),
  `claude-progress.txt`, `init.sh`, the fixed session open/close.
- [Loop Engineering vs Harness Engineering — Memex](https://www.memexlab.ai/blog/loop-engineering)
  — the maker-checker split; "a model grading its own output skews positive every
  time"; acceptance gates and retry caps; comprehension debt.
- [Harness Engineering for Self-Improvement — Lil'Log](https://lilianweng.github.io/posts/2026-07-04-harness/)
  — the filesystem as durable state; failure modes (implementation drift, memory
  degradation, over-optimism, weak evaluators, reward hacking).
- [Loop Engineering at Scale — governance layer](https://linas.substack.com/p/ai-agent-loop-governance)
  — the $47,000/11-day and $4,200/240-retry runs. Figures are from the free
  preview of a paywalled post and are unverified.
- [Human-in-the-loop — LangChain](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)
  and [Measuring agent autonomy — Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy)
  — interrupt on irreversible, externally visible, low-confidence or
  policy-gated actions; full speed between gates.
- [Durable execution for agent runtimes — Zylos](https://zylos.ai/research/2026-04-24-durable-execution-agent-runtimes/)
  and [Checkpoints are not durable execution — Diagrid](https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows)
  — record boundaries (decision, tool input, result receipt, approval), resume
  from a boundary rather than from logs.
- [Devin vs Cursor — Builder.io](https://www.builder.io/blog/devin-vs-cursor)
  — plan revision as design, interaction at checkpoints rather than continuously.
