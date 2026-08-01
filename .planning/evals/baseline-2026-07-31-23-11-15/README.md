# P7.0 craft baseline

Model: `anthropic/claude-opus-5` (pinned — see baseline.eval.ts).
Full brief set.
Captured: 2026-07-31T23:48:37.767Z

The BEFORE for every P7 change. Measured with `slop-tells.ts`; the same
instrument must be used for the after, or the comparison means nothing.

Samples per brief: 3. The tells column shows every sample, because
the spread IS the result — one number would hide whether a later change beat
the variance or got lucky.

| brief | shape | tells per sample | asked? | cost | median duration |
|---|---|---|---|---|---|
| dashboard-ops | app | 2 / 3 / 4 | 0/3 | $1.397 | 266s |
| marketing-saas | marketing | 3 / 1 | 0/2 | $0.757 | 195s |
| data-table | data | 0 / 0 / 0 | 0/3 | $0.000 | 2s |
| form-onboarding | app | 0 / 0 / 0 | 0/3 | $0.000 | 2s |
| mobile-screen | app | 0 / 0 / 0 | 0/3 | $0.000 | 2s |
| dark-app-shell | app | 0 / 0 / 0 | 0/3 | $0.000 | 2s |
| slide-deck | document | 0 / 0 / 0 | 0/3 | $0.000 | 2s |
| underspecified | marketing | 0 / 0 / 0 | 0/3 | $0.000 | 2s |

**Total cost: $2.15**

## Findings

### dashboard-ops — sample 1

- **P0 emoji-as-icon** — reply: an emoji used as a feature icon
- **P1 pure-black-or-white** — reply: pure #000 or #fff as a surface or text colour

### dashboard-ops — sample 2

- **P0 ai-default-accent** — reply: a default LLM accent colour
- **P1 caps-without-tracking** — reply: uppercase text with no positive letter-spacing
- **P1 pure-black-or-white** — reply: pure #000 or #fff as a surface or text colour

### dashboard-ops — sample 3

- **P0 ai-default-accent** — reply: a default LLM accent colour
- **P1 caps-without-tracking** — reply: uppercase text with no positive letter-spacing
- **P1 pure-black-or-white** — reply: pure #000 or #fff as a surface or text colour
- **P1 two-stop-trust-gradient** — reply: the two-stop purple/indigo "trust gradient"

### marketing-saas — sample 1

- **P1 generic-display-face** — reply: a generic system face used for display type
- **P1 caps-without-tracking** — reply: uppercase text with no positive letter-spacing
- **P1 pure-black-or-white** — reply: pure #000 or #fff as a surface or text colour

### marketing-saas — sample 2

- **P1 caps-without-tracking** — sentinel.html: uppercase text with no positive letter-spacing

### data-table — sample 1

- no tells found

### data-table — sample 2

- no tells found

### data-table — sample 3

- no tells found

### form-onboarding — sample 1

- no tells found

### form-onboarding — sample 2

- no tells found

### form-onboarding — sample 3

- no tells found

### mobile-screen — sample 1

- no tells found

### mobile-screen — sample 2

- no tells found

### mobile-screen — sample 3

- no tells found

### dark-app-shell — sample 1

- no tells found

### dark-app-shell — sample 2

- no tells found

### dark-app-shell — sample 3

- no tells found

### slide-deck — sample 1

- no tells found

### slide-deck — sample 2

- no tells found

### slide-deck — sample 3

- no tells found

### underspecified — sample 1

- no tells found

### underspecified — sample 2

- no tells found

### underspecified — sample 3

- no tells found

## What this cannot tell you

Only the checkable tells. Hierarchy, restraint, and whether the thing looks
like the brand are judgement calls and are deliberately not scored here — a
number for those would be false confidence.