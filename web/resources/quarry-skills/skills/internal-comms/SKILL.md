---
name: internal-comms
description: Write clear, scannable internal communications — team updates, announcements, change notifications, incident write-ups, retros, stand-up notes, kickoffs, and launch emails. Use this skill whenever the user asks to draft an internal email, Slack post, team update, comms to stakeholders, change announcement, incident postmortem, or anything intended for internal team or company audience. Also triggers on "write a memo", "draft an update", "notify the team".
---

# Internal Communications

Write internal comms that people actually read.

## Principles

**Hook first, detail later.** Lead with the outcome or ask, not background. If someone reads only the first line, they should know what this is about.

**Scannable.** Use bolded keywords, short paragraphs (2-3 sentences), bullet lists for parallel items. Dense prose is a wall. Dense prose loses readers.

**Concrete.** Numbers, dates, names. Not "soon" — "Tuesday 2pm". Not "most teams" — "12 of 15 teams".

**Own the ask.** Every comms piece has ONE primary action the reader should take. Make it unambiguous: "Reply yes/no by Friday" or "No action needed — FYI only".

## Formats

### Slack announcement

```
:tada: Shipped: [thing]

**What:** One-line description.

**Why it matters:** One sentence on user or business impact.

**Who's affected:** Team / audience.

**Next steps:** What readers should do (or "No action needed").

Questions → DM [name].
```

### Team update (weekly)

```
**This week**
- Shipped [X], resulting in [outcome]
- Started [Y], on track for [date]
- Blocker: [Z] — [who's unblocking]

**Next week**
- Priorities: [top 3]

**Needs from team:** [specific asks, or "none"]
```

### Incident announcement

```
**Status: [Investigating / Mitigating / Resolved]**

**Impact:** Who/what is affected, started at [time].

**Current state:** What we know and don't know.

**What we're doing:** Next concrete step + owner.

**Next update:** [time].
```

### Launch email

Subject line is **short, specific, and benefit-oriented**. "New feature: you can now X" beats "Exciting Q3 launch announcement".

Open with the single sentence that matters most. Then:
1. What changed
2. Why it matters to them
3. How to use / what to do
4. Who to contact

End with a human signature — first name, not "The team".

### Retro

```
**Context:** [project / sprint / incident], [duration]

**What went well**
- [Specific behavior/decision + outcome]

**What didn't**
- [Specific issue + impact, no blame]

**What we're changing**
- [Concrete action + owner + date]
```

## Voice

- **Warm but efficient** — first person plural ("we"), direct but not cold
- **No corporate filler** — cut "please be advised", "kindly note", "at this time"
- **Own mistakes** — "We underestimated X" beats "There were challenges with X"
- **Avoid passive voice** — "We shipped it" not "It was shipped"

## Things to cut

Before sending, delete:
- "I hope this finds you well" and any greeting padding
- "Just wanted to let you know" — just tell them
- "As you may be aware" — say it directly
- "Please don't hesitate to" — they know they can email you
- Any sentence that doesn't change the reader's understanding or actions

## Format rules

- **Subject/headline**: ≤ 60 chars, specific outcome
- **Opening line**: the main point, in one sentence
- **Body**: 150 words max for Slack, 300 for email, unless technical depth required
- **Sign-off**: first name only; no "cheers" unless it's already the team style

When producing these, output plain markdown. Do not use an artifact block unless the user asks for formatted rendering.
