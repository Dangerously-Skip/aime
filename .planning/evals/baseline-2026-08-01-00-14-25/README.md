# P7.0 craft baseline

Model: `anthropic/claude-opus-5` (pinned — see baseline.eval.ts).
Partial run: data-table, form-onboarding, mobile-screen, dark-app-shell, slide-deck, underspecified. Not a full baseline.
Captured: 2026-08-01T01:46:39.291Z

The BEFORE for every P7 change. Measured with `slop-tells.ts`; the same
instrument must be used for the after, or the comparison means nothing.

Samples per brief: 3. The tells column shows every sample, because
the spread IS the result — one number would hide whether a later change beat
the variance or got lucky.

| brief | shape | tells per sample | asked? | cost | median duration |
|---|---|---|---|---|---|
| data-table | data | 2 / 2 / 2 | 2/3 | $9.208 | 1906s |
| form-onboarding | app | 3 / 5 / 1 | 3/3 | $4.548 | 683s |
| mobile-screen | app | FAIL / FAIL / FAIL | 0/3 | $0.000 | 2s |
| dark-app-shell | app | FAIL / FAIL / FAIL | 0/3 | $0.000 | 2s |
| slide-deck | document | FAIL / FAIL / FAIL | 0/3 | $0.000 | 1s |
| underspecified | marketing | FAIL / FAIL / FAIL | 0/3 | $0.000 | 1s |

**Total cost: $13.76**

## Findings

### data-table — sample 2 (asked a question; auto-answered)

- **P1 caps-without-tracking** — index.html: uppercase text with no positive letter-spacing
- **P1 pure-black-or-white** — index.html: pure #000 or #fff as a surface or text colour

### data-table — sample 3

- **P0 ai-default-accent** — invoices.html: a default LLM accent colour
- **P1 pure-black-or-white** — invoices.html: pure #000 or #fff as a surface or text colour

### form-onboarding — sample 1 (asked a question; auto-answered)

- **P0 ai-default-accent** — account-setup.html: a default LLM accent colour
- **P1 pure-black-or-white** — account-setup.html: pure #000 or #fff as a surface or text colour
- **P1 caps-without-tracking** — account-setup.html: uppercase text with no positive letter-spacing

### data-table — sample 1 (asked a question; auto-answered)

- **P1 caps-without-tracking** — src/index.css: uppercase text with no positive letter-spacing
- **P1 pure-black-or-white** — src/index.css: pure #000 or #fff as a surface or text colour

### form-onboarding — sample 2 (asked a question; auto-answered)

- **P1 populated-state-only** — src/components/ProgressStepper.tsx: only the populated state appears — no empty, loading or error state
- **P1 populated-state-only** — src/components/SetupComplete.tsx: only the populated state appears — no empty, loading or error state
- **P0 ai-default-accent** — src/index.css: a default LLM accent colour
- **P1 caps-without-tracking** — src/index.css: uppercase text with no positive letter-spacing
- **P1 pure-black-or-white** — src/index.css: pure #000 or #fff as a surface or text colour

### form-onboarding — sample 3 (asked a question; auto-answered)

- **P1 populated-state-only** — src/components/Stepper.tsx: only the populated state appears — no empty, loading or error state

### mobile-screen — sample 1

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 1491. To increase, visit https://openrouter.ai/settings/credits and add more credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance.","provider_name":null,"previous_errors":[{"code":402,"message":"This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 1491. To increase, visit https://openrouter.ai/settings/credits and add more credits"},{"code":402,"message":"This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 1491. To increase, visit https://openrouter.ai/settings/credits and add more credits"},{"code":402,"message":"This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 1491. To increase, visit https://openrouter.ai/settings/credits and add more credits"},{"code":402,"message":"This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 1491. To increase, visit https://openrouter.ai/settings/credits and add more credits"},{"code":402,"message":"This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 1491. To increase, visit https://openrouter.ai/settings/credits and add more credits"}]}},"user_id":"user_2vf5YqK9yknOUFHMouxhRD2tRfB"}. Not a result.

### mobile-screen — sample 2

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### mobile-screen — sample 3

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### dark-app-shell — sample 1

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### dark-app-shell — sample 2

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### dark-app-shell — sample 3

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### slide-deck — sample 1

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### slide-deck — sample 2

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### slide-deck — sample 3

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### underspecified — sample 1

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### underspecified — sample 2

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

### underspecified — sample 3

- **PRODUCED NOTHING** — Claude Code returned an error result: API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402,"metadata":{"limit_source":"openrouter_credits","remedy_hint":"Add credits at https://openrouter.ai/settings/credits, or lower max_tokens / prompt size to fit your remaining balance."}}}. Not a result.

## What this cannot tell you

Only the checkable tells. Hierarchy, restraint, and whether the thing looks
like the brand are judgement calls and are deliberately not scored here — a
number for those would be false confidence.