# P7.0 craft baseline

Model: `anthropic/claude-opus-5` (pinned — see baseline.eval.ts).
Partial run: only `underspecified`. Not a full baseline.
Captured: 2026-07-31T17:34:39.166Z

The BEFORE for every P7 change. Measured with `slop-tells.ts`; the same
instrument must be used for the after, or the comparison means nothing.

| brief | shape | files | reply | tools | tells | cost | duration |
|---|---|---|---|---|---|---|---|
| underspecified | marketing | 0 | 1193c | 1 | 0 P0, 0 P1 | ? | 321s |

## Findings

### underspecified

- no tells found

## What this cannot tell you

Only the checkable tells. Hierarchy, restraint, and whether the thing looks
like the brand are judgement calls and are deliberately not scored here — a
number for those would be false confidence.