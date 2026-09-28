# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where applicable. Releases before this file existed are listed on the
[GitHub Releases](https://github.com/Dangerously-Skip/aime/releases) page.

## [Unreleased]

### Added
- `CONTRIBUTING.md`, issue templates (bug, feature) and a pull request template.
- A complete, tracked `web/.env.example`, checked by a test against every
  environment variable the app reads.
- Failed turns carry a typed error code, and Settings can be opened on a
  specific section.

### Changed
- The Bash reminder marker is now `AIME_CRON:`; the old `QUARRY_CRON:` is
  still recognised.
- Log lines name the application `aime` instead of the internal name.
- Node.js 22 or newer is the documented requirement.

### Removed
- Unused API routes (`/api/providers`, `/api/sessions`, `/api/session/reset`,
  `/api/memory/daily`, `/api/identity/voice-md`, `/api/connectors/status`,
  `/api/connectors/oauth/refresh`, `/api/customize/status`) and unmounted hooks.
- The root `.env.example`, which nothing loaded; use `web/.env.example`.

### Fixed
- `cp .env.example .env` in `web/` failed on a fresh clone because the file
  was gitignored.
- `SECURITY.md` now describes how the Security toggles are actually enforced.

[Unreleased]: https://github.com/Dangerously-Skip/aime/compare/v1.7.2...main
