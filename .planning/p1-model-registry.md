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

## DR-10 (RESOLVED → B): non-Claude agent models via anthropic-compat

**Decided: Option B.** Non-Claude models (Kimi K2, GPT, Gemini, …) drive the
agent loop through an `anthropic-compat` provider — a base-URL endpoint that
speaks the Anthropic wire format. A compat model is just `agentCapable: true`
on an `anthropic-compat` provider; the resolver already handles it, no new
code path. **Option C (opencode / a second engine) is out** — the Agent SDK
is capable, and we shape non-Anthropic calls into its wire format instead.

## Tiers (updated): cheap / good / smort / stallion

Four tiers, premium-first: `stallion` > `smort` > `good` > `cheap`.
`stallion` is the top **coding** tier (e.g. Fable). Most capabilities don't
populate it — a `stallion` request for a capability without one tumbles down
to `smort`. Default registry: `code.stallion = [Fable, Opus]`; chat has no
stallion tier. Example mapping: haiku=cheap, sonnet=good, opus=smort,
fable=stallion.

## DR-11 (needs owner sign-off): the translation layer ("small LiteLLM")

With the nib gateway (a LiteLLM deployment) gone, how do non-Anthropic models
reach the Agent SDK, which only speaks the Anthropic wire format?

Two classes of provider:

1. **Already Anthropic-compatible** — providers that expose an Anthropic-format
   endpoint. **OpenRouter does** (and hosts Kimi K2, GPT, Gemini, …), as do
   Anthropic direct, Bedrock, and Vertex. For these, set `ANTHROPIC_BASE_URL`
   + the model alias and route **directly — no local layer needed**.
2. **OpenAI-compatible only** — local models (Ollama, LM Studio) and raw
   OpenAI-style endpoints speak the OpenAI format, *not* Anthropic. To drive
   these through the SDK, a request/response **translation shim** is required.

**Recommendation: build a small, embedded, TypeScript Anthropic-compat shim —
scoped to class 2 only.** A local Next.js route (`/api/llm-proxy/...`, bound
to localhost) that accepts Anthropic-format requests and translates to/from
OpenAI-compatible providers, reusing the `openai` dep already in the tree. The
Agent SDK points `ANTHROPIC_BASE_URL` at it *only* for local/OpenAI-compat
providers; class-1 providers bypass it entirely.

- **Not** a vendored LiteLLM (Python + separate process) — against the
  local-first, all-TypeScript grain, and unnecessary when OpenRouter already
  covers most hosted non-Claude models.
- The shim's surface stays small precisely because OpenRouter absorbs the
  hosted long tail; the shim exists mainly to unlock **local models**.

### What about `search`?

`search` is a **capability served by a tool, not a model driven through the
SDK** — today the `web-search` searxng MCP. It never touches the translation
layer: any agent-capable model that can call tools gets search for free. The
registry's `search` capability slot picks the *search backend* (searxng /
Brave / Perplexity), independent of DR-11. (If "search" meant a
search-augmented *model* or RAG embeddings, that's a different slot — flag it.)

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
- **P1.4** — the anthropic-compat translation shim (DR-11): OpenRouter
  direct-route path + the local Next.js OpenAI↔Anthropic shim for
  local/OpenAI-compat providers.
- **P1.5** — capability calls: image/mesh (FAL/OpenAI) + embedding, called
  outside the agent loop; `search`/`voice` already covered.
- **P1.6** — guided provider setup UIs (Bedrock, Vertex, local/Ollama, BYOK
  OpenRouter/FAL) + onboarding rework around provider paths.
- **P1.7** — RouteSettings: thinking budget (exists), warmth, explicit
  tumbling chains, cost-compaction budget policy.

DR-4 (warmth = temperature vs persona) and DR-5 (mesh slot only) fold in at
P1.7 / P1.5.
