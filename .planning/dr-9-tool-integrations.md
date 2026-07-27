# DR-9 RESOLVED — MCP-native, not Composio (revisit at P5 for hosted)

> Verified 2026-07-27. Sources at the bottom; SDK facts read from the installed
> `@anthropic-ai/claude-agent-sdk` type definitions, not from memory.

## The question

AIME needs "a lot of functionality connected" — Gmail, Slack, Jira, Notion,
Drive, Stripe, whatever the user already lives in. Do we integrate a
tool-integration platform (Composio and friends), or invest elsewhere?

## The landscape (verified)

| | model | catalog | licence / self-host | who holds user tokens | cost |
|---|---|---|---|---|---|
| **Composio** | cloud tool-calling platform + MCP | 1000+ toolkits | SDKs MIT; **platform cloud-only** (VPC/on-prem = enterprise sales) | **Composio** (server-side, auto-refresh) | metered **per tool call**: 20K/mo free, $29 → 200K, $229 → 2M |
| **Nango** | agentic API platform + MCP server | 900+ APIs | **Elastic License** (source-available, not OSI); self-host free w/ limited features | you (self-hosted) or Nango Cloud | seat/usage, cloud |
| **Arcade.dev** | MCP runtime, per-user OAuth | ~80 first-party servers | cloud | Arcade | usage |
| **Pipedream Connect** | low-code workflows + MCP | widest action library | cloud | Pipedream | usage |
| **MCP ecosystem direct** | protocol, no vendor | **~9.6k records in the official registry; ~20k indexed on mcp.so** | n/a | **the user's own machine** | **£0** |

## The decisive facts for AIME specifically

**1. The Agent SDK already speaks remote MCP.** From the installed typings:

```ts
export declare type McpHttpServerConfig = {
    type: 'http';
    url: string;
    headers?: Record<string, string>;
    tools?: McpServerToolPolicy[];
};
export declare type McpServerToolPolicy = {
    name: string;
    permission_policy: 'always_allow' | 'always_ask' | 'always_deny';
};
```

So AIME can point at any vendor-hosted MCP endpoint, carry a bearer token in
`headers`, and declare **per-tool permission policy** — with no new transport
code. That last field composes directly with the C3 approval classifier: our
`classifyToolCall()` can emit an SDK-level policy instead of only intercepting
in `canUseTool`.

**2. Composio inverts AIME's trust model.** Composio stores the end user's
OAuth tokens server-side and refreshes them; the docs describe no mode where
tokens stay on the user's machine. AIME is local-first: BYOK keys in the OS
keychain, credentials encrypted at rest, "your machine, your data". Routing
every user's Gmail and Slack tokens through a third-party SaaS is not a
trade-off against that positioning — it contradicts it, and token custody is
precisely what a local-first user cares most about.

**3. Per-call metering fights the architecture we just built.** P6 gave AIME
schedulers, standing orders and widget refreshes — unattended loops that make
tool calls on a timer, by design. Metering per tool call turns our own autonomy
features into a meter. A single grounded widget refreshing every 30 minutes at
~6 tool calls is ~8.6K calls/month; five of those exceeds the free tier before
a human has typed anything.

**4. Open-source distribution.** Every AIME user would need their own Composio
account and API key — a signup wall and a hard dependency on a commercial
service, inside an app whose pitch is that it runs on your machine with your
keys. The alternative (we pay centrally) is P5 hosted-edition territory, not
desktop.

**5. It would replace a layer we already have, not fill a gap.** AIME already
has an OAuth connector registry, keychain credential storage, and MCP
provisioning into `~/.claude/.mcp.json`. Composio would supersede tested code
rather than add a missing capability.

## Decision

**Do not integrate Composio (or any hosted tool platform) into the open-source
desktop app.** Invest instead in being an *excellent MCP client* — which is
where the leverage actually is: ~20k community servers, and vendors now shipping
their own OAuth 2.1 remote MCP endpoints, at zero marginal cost and zero
third-party token custody. The catalog argument for Composio (1000+ toolkits)
is no longer a differentiator when the open ecosystem is an order of magnitude
larger and speaks the protocol we already implement.

**Revisit at P5 for the hosted edition**, where the calculus flips: we already
run a relay/auth server (see C6/mobile), accounts exist, and per-user token
custody is expected of a hosted product. **Nango is the better candidate there
than Composio** — self-hostable, so it becomes part of *our* infrastructure
rather than a dependency on someone else's — with the caveat that the Elastic
License is source-available, not OSI open source, so it can never ship inside
the open-source desktop build.

## What "excellent MCP client" means concretely (the P3 work)

1. **Remote MCP with OAuth** — the unlock. Vendor-hosted endpoints (Gmail,
   Slack, Notion, Linear, Atlassian…) need `type:'http'` + a bearer token from
   an OAuth 2.1 flow we already mostly have. This is what makes "connect my
   Gmail and send an email" work without us maintaining a single connector.
2. **A server catalog + one-click add**, backed by the official MCP registry,
   with the same scan→enable shape as the provider manager (which users already
   know from P2).
3. **Per-tool policy** — surface `McpServerToolPolicy` from the C3 classifier so
   a newly added server's consequential tools are `always_ask` by default rather
   than silently allowed. A one-click server add must not be a one-click
   privilege escalation.
4. **Tool-count discipline.** A user with ten servers mounted can exceed a
   sensible tool budget; the model degrades well before the context does.
   Needs per-server enable/disable and a visible count — the same lesson as the
   345-model picker flood.

## Sources

- Composio docs / pricing / repo: <https://docs.composio.dev/>,
  <https://composio.dev/pricing>, <https://github.com/ComposioHQ/composio>
  (MIT SDKs, 29.4k stars, "1000+ toolkits"; tiers 20K/200K/2M calls per month)
- Composio auth model: <https://docs.composio.dev/docs/authenticating-tools>
- Nango: <https://github.com/NangoHQ/nango> (Elastic License; "Run it on Nango
  Cloud or self-host"; 900+ APIs)
- Comparison landscape (vendor blogs, read with that bias in mind):
  <https://nango.dev/blog/composio-alternatives/>,
  <https://nango.dev/blog/best-mcp-servers-for-agent-api-integrations/>,
  <https://www.scalekit.com/blog/composio-alternatives>
- MCP ecosystem size: <https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol>,
  <https://tooldirectory.ai/blog/state-of-mcp-servers-2026>
- SDK transport + tool-policy types: installed
  `@anthropic-ai/claude-agent-sdk/sdk.d.ts` lines 897–902, 975–978, 998–1003
