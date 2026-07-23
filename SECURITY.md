# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AIME, please report it privately
via [GitHub Security Advisories](https://github.com/Dangerously-Skip/aime/security/advisories/new).
Do not file public issues or pull requests for security findings.

## Scope notes

AIME is a local-first desktop app: the agent runs with your user account's
permissions. Security-relevant settings (dangerous-command blocking, network
command blocking, project-folder write restriction, Bash disable) live in
Settings → Security and are enforced via the system prompt and tool filtering.
