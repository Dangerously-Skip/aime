# DR-14 RESOLVED — connector secrets encrypted at rest (option B)

> Decided and implemented 2026-07-27. Commit `5da8ca6`.

## The question

`~/.claude/.aime-mcp.json` held OAuth access tokens, API keys, refresh tokens and
OAuth client secrets in cleartext at `0600`. Should they move into the
keychain-backed AES-256-GCM store built in P1.2?

## The fact that decided it

**The SDK never reads that file.** `loadProvisionedMcpServers()` reads it and
hands the SDK an in-memory object (`claude-provider.ts`). Claude Code's own
`.mcp.json` is a *separate* file we read but never write. So plaintext was a
format choice we were free to change, not a constraint imposed by the SDK.

## What was in there

| Secret | Durability |
|---|---|
| OAuth access token | ~1 hour |
| **API keys / PATs** | **until revoked** |
| **Refresh token** | **until revoked** |
| **OAuth client secret** | **until rotated** |

Three of four are durable. A refresh token or PAT captured from a year-old backup
still works today.

## Threat model, stated honestly

`0600` stops *other users*. It does not stop a process running as you, and the
master key is injected into the Next server's environment as `AIME_CRED_KEY`, so
a same-user attacker who can read that process gets the key too.

**Encryption at rest buys exactly one thing: protection when the file leaves the
machine or outlives the process.** Time Machine, home-directory cloud sync, a
resold or stolen disk, a support bundle, a config pasted into a bug report. It
does **not** buy protection from local malware. Claiming otherwise would be
overselling it.

That is still worth having, because the durable secrets above remain valid long
after a backup was taken.

## Decision: option B — move all of them

Rejected options:

- **A (leave it)** — accepts that any synced or backed-up home directory carries
  live durable credentials for every connected service in cleartext.
- **C (move only the durable ones)** — sounds like the cheap middle but isn't:
  once B's injection machinery exists, excluding access tokens saves nothing and
  leaves a live credential on disk for no benefit. The durable/short-lived split
  is also not structural — a GitHub PAT sits in exactly the same `env` field an
  expiring OAuth token does.

The public entry keeps its full shape with a visible `${AIME_SECRET}` sentinel in
place of each secret, rather than dropping fields, so the file still documents
which env var and header a connector uses and a reader can see the value is held
elsewhere rather than missing.

## The no-key fallback is deliberate and visible

Running `next dev` outside Electron, or self-hosting the web app, means no master
key. In that case secrets stay inline in the `0600` file and `/api/doctor`
reports it as a warning with a fix.

Reasoning: refusing to store credentials would make connectors untestable in
development, and silently *pretending* to encrypt would be worse than either.
`main-web.js` already set this precedent for the headless-Linux keyring case,
where it falls back and logs. Consistency beat inventing a second policy.

## Two bugs the property tests caught

1. A single "the token" field left every **additional** credential in cleartext
   when an entry carried more than one env var — and P3.1c proved such entries
   exist. Now keyed maps, restored by name.
2. `injectSecrets` used `String.replace` with a replacement **string**, so `$$`,
   `$&` and `` $` `` in a token were reinterpreted and the credential silently
   corrupted on the way to the service — surfacing as an inexplicable 401. Now a
   replacer function, with the counterexample pinned as a regression test.

## Known remaining limits

- Same-user process access, as above. Closing it would need the key outside the
  server's environment entirely (e.g. per-request retrieval from main), which
  buys little while the server can be read anyway.
- Claude Code's own `.mcp.json` is untouched: we do not own it.
