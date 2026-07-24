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

## DR-12 (RESOLVED): provider model = one type, three transports

Add providers (Anthropic, OpenAI, Google, Groq, OpenRouter, Bedrock, Azure,
Fal, local, …) by API key. One `Provider` concept, discriminated by
**`transport`** — the single field that decides how a provider's models
execute:

| transport | providers | drives agent loop? | reached how |
|---|---|---|---|
| `anthropic-native` | anthropic, bedrock, vertex, openrouter | ✅ | env/base-URL; SDK drives directly (no translation) |
| `openai-compat` | openai, azure, groq, gemini-direct, local | ✅ via the DR-11 shim | OpenAI-format endpoint; capability calls hit it directly |
| `native-fal` | fal | ❌ capability-only | bespoke image/mesh/audio API, outside the loop |

Design:

- **Preset catalog, not a blank form.** Ship each provider as a
  `ProviderPreset` template that knows its transport, default base URL,
  required credential fields, capabilities, and how to list models. "Add
  provider" = pick a preset → paste key. A `custom` preset is the escape hatch.
- **Credentials in the OS keychain, never localStorage.** BYOK keys are
  secrets. Store via Electron `safeStorage`: the main process holds a master
  key in the keychain and injects a derived AES-256-GCM key into the Next
  server as `AIME_CRED_KEY`; the server reads/writes an encrypted
  `credentials.enc` blob with it. Keys never reach the renderer.
- **Scan = call the provider's own list endpoint.** openai/azure/groq/gemini
  `/v1/models`, anthropic `/v1/models`, and OpenRouter's rich
  `/api/v1/models` (pricing + context + modality → auto-classify capability/
  tier). Fal is a static catalog; Bedrock/Vertex/Azure model lists come later.
  Flow: add + key → scan → enable models → they drop into the capability×tier
  grid.
- **`transport` is derived-not-duplicated with the registry's `ModelProvider.kind`** —
  kind stays the routing reference; transport is the coarse execution strategy
  used by the executor and the provider-config store.

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
- **P1.2** — provider layer (DR-12): `Provider`/`ProviderPreset` types +
  transport, the preset catalog for the ~10 providers, keychain-backed
  credential store (AES-256-GCM), and the `/api/models/scan` endpoint +
  normalizers. *(this slice)*
- **P1.2b** — add-provider round-trip: keychain credential write endpoint
  (`/api/models/providers/credentials`) + client `provider-store`
  (`aime:providers`). *(done)*
- **P1.3 (server)** — `/api/chat/[surfaceId]` resolves `(capability, tier)`
  through the default registry (availability from apiKey/env), explicit model
  override preserved; `/api/models` serves the registry + tier grid. *(done)*
  Client wiring — surfaces *sending* `(capability, tier)` and the tier
  selector — is P2 (surface clarity); today's explicit-model path is unchanged.
- **P1.3b** — execute a model on a **user-added** provider: the request
  carries a non-secret `providerConfig` (`providerId`, `transport`, `baseUrl`);
  the server resolves the key from the keychain (by `providerId`) or a transient
  request key, and drives the SDK against the provider's Anthropic-compat base
  URL (`ANTHROPIC_BASE_URL`). `resolveExecution()` is the seam the P1.4 shim
  extends for `openai-compat`. *(done)*
- **P1.3-orig** — wire agent surfaces: chat/code/cowork request `(capability,
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
