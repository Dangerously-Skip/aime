# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AIME, please report it privately
via [GitHub Security Advisories](https://github.com/Dangerously-Skip/aime/security/advisories/new).
Do not file public issues or pull requests for security findings.

Fixes land on `main` and ship in the next release; only the latest release is
supported.

## Scope notes

AIME is a local-first desktop app: the agent runs with your user account's
permissions, on your machine. What stands between the agent and your system
is described below — precisely, because a control that overstates its reach is
worse than one that admits its limits.

### Settings → Security

Each toggle is marked in the UI as **enforced** or **guidance**. All four
current toggles are enforced: they are decided server-side in the Agent SDK's
`canUseTool` hook, which runs on every tool call regardless of the session's
permission mode, on every surface, subagent and scheduled run. The values are
stored in `~/.aime/security.json` so the server — not the renderer — owns them.

| Toggle | What is refused |
|--------|-----------------|
| Ask before destructive commands | `rm -rf`, `sudo`, `mkfs`, `dd`, `chmod 777`, force-pushes and similar pause for your approval; unattended runs refuse them |
| Ask before commands that reach the network | netcat/socat, SSH tunnels, curl uploads, scp/rsync to remote hosts, piping a download into an interpreter; unattended runs refuse them |
| Restrict writes to project folder | file tools cannot write outside the working directory (scratch/temp excepted); obvious shell redirects are refused too, but shell commands are not fully sandboxed |
| Disable Bash tool | Bash, BashOutput and KillShell are denied for the session |

A toggle may only claim `enforced` if a test drives the real `canUseTool` and
gets a denial (`security-section.enforcement.test.ts`); the guards themselves
live in `web/src/lib/security/` and are mutation-tested weekly.

These are guardrails for an agent acting on your behalf, not a sandbox against
a hostile one. Reading files outside the project is allowed.

### Local API

The app's Next.js server binds to `127.0.0.1`, and every `/api` route requires a
per-launch token (exchanged for an `HttpOnly`, `SameSite=Strict` cookie) plus an
Origin check, so other pages open in your browser cannot drive it. With no token
configured the API refuses everything rather than falling open.

### Credentials

Provider API keys and connector tokens are stored encrypted in
`~/.aime/credentials.enc`; the key is kept in the OS keychain via Electron's
`safeStorage`.
