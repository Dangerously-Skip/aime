# P1 — Model & Provider Registry (design)

> The open-source viability gate. Today models are hardcoded
> (`'sonnet'|'opus'|'haiku'`) and reach Claude via the Anthropic API or Bedrock.
> Goal: surfaces/features request a **capability + tier**, and a registry
> resolves that to a concrete model on a configured provider — with fallback
> ("tumbling") and budget-aware downgrade ("cost compaction").

## The load-bearing constraint: the Agent SDK drives Claude only

The Claude Agent SDK is the execution engine for the agentic surfaces (chat,
cowork, code, browser, assistant). It can only drive **Claude-family models**,
reached four ways:

1. **Anthropic API** — `ANTHROPIC_API_KEY`
2. **Bedrock** — `CLAUDE_CODE_USE_BEDROCK=1` + AWS creds
3. **Vertex** — `CLAUDE_CODE_USE_VERTEX=1` + GCP creds
4. **Anthropic-compat base URL** — `ANTHROPIC_BASE_URL` pointing at a proxy
   that speaks the Anthropic wire format (LiteLLM, OpenRouter's anthropic
   endpoint, etc.). This is the ONLY way a *non-Claude* model can drive the
   agent loop — it's exactly what the nib gateway did.

You cannot hand a raw OpenAI/Gemini key to the Agent SDK. So "multi-provider"
splits cleanly into two tiers:

- **Agent models** (`chat`, `code`) — must be Claude-compatible: anthropic /
  bedrock / vertex / anthropic-compat-proxy. Tier picks opus/sonnet/haiku or
  the proxy's alias.
- **Capability models** (`image`, `mesh3d`, `voice`, `embedding`, and
  standalone `search`) — one-shot calls OUTSIDE the agent loop, via each
  provider's native SDK. Here any provider works directly (FAL, OpenAI,
  local, …). `voice` is already local Whisper; `search` is already MCP.

This two-tier split is the core design and resolves what "multi-provider"
means without pretending the SDK can do something it can't.

## DR-10 (needs owner input): how far to take non-Claude agent models

The registry core (below) is decision-independent. But wiring the *agent*
surfaces to non-Claude models depends on this call:

- **Option A — Claude-only agent, multi-provider capabilities.** Agent
  surfaces stay Claude (anthropic/bedrock/vertex). The registry adds
  image/mesh/voice/embedding providers for the non-agentic capabilities.
  Simplest; ships fastest; matches what the SDK natively does.
- **Option B — add an `anthropic-compat` provider kind.** Lets users point
  the agent at a LiteLLM/OpenRouter proxy to drive GPT/Gemini/etc. through
  the loop. More power, more support surface (non-Claude models handle the
  agent/tool protocol with varying fidelity).
- **Option C — a second execution engine** for non-Claude agentic use (what
  opencode was). Largest; probably not worth it pre-demand.

**Lean: A now, B as a provider kind behind the same registry** (the
resolution logic already supports it — a compat model is just `agentCapable:
true` on an `anthropic-compat` provider). C stays out unless demand appears.

## Registry core (P1.1 — decision-independent, in this slice)

```
Capability = chat | code | image | search | mesh3d | voice | embedding
Tier       = cheap | good | smort           // TIER_ORDER: smort > good > cheap

ModelProvider { id, label, kind, credentialEnv[]? }
  kind = anthropic | bedrock | vertex | anthropic-compat | openai | fal | local
Model { id, providerId, label, capabilities[], driverModel, agentCapable,
        contextWindow?, pricing? }
RoutingTable = Capability → Tier → modelId[]   // ordered: primary, then tumbling fallbacks
ModelRegistry { providers[], models[], routing }
```

`resolveRoute(registry, capability, tier, isAvailable)` →
`{ model, provider, capability, tier, degraded }`:

1. Try the candidate list for `(capability, tier)` in order; return the first
   whose provider `isAvailable` (has credentials). `degraded = index > 0`.
2. If none, **tier-tumble** downward (smort→good→cheap) and retry — this is
   "auto model-tumbling" / the floor of "cost compaction".
3. `null` if nothing resolvable.

`isAvailable` is injected (pure core; production wires it to settings/env).
The default registry reproduces today exactly: Claude opus(smort) /
sonnet(good) / haiku(cheap) for chat+code on the `anthropic` + `bedrock`
providers, so it's a no-behaviour-change drop-in.

## Slices

- **P1.1** — registry core: types, `resolveRoute` + tumbling, default Claude
  registry, tests. *(this slice — no UI, no wiring, nothing breaks)*
- **P1.2** — model-registry **store** (persisted): user-added providers,
  scanned models, per-capability/tier defaults, `isAvailable` from settings.
- **P1.3** — wire agent surfaces: chat/code/cowork request `(capability,
  tier)`; `/api/chat` + ClaudeProvider resolve via the registry; keep the
  raw `model` override path working. `/api/models` reads the registry.
- **P1.4** — capability calls: image/mesh (FAL/OpenAI) + embedding, called
  outside the agent loop; `search`/`voice` already covered.
- **P1.5** — guided provider setup UIs (Bedrock, Vertex, local/Ollama, BYOK
  OpenRouter/FAL) + onboarding rework around provider paths.
- **P1.6** — RouteSettings: thinking budget (exists), warmth, explicit
  tumbling chains, cost-compaction budget policy.

DR-4 (warmth = temperature vs persona) and DR-5 (mesh slot only) fold in at
P1.6 / P1.4.
