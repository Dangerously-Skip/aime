# Phase 1 Plan 3: Multi-Surface Provider Refactor

Surface-routed query dispatch in ClaudeProvider with per-surface config merging, composite abort keys, and Bedrock env passthrough.

## What Was Done

### Task 1: Update BaseProvider with surfaceId support

Added `getAbortKey(chatId, surfaceId)` helper method to `BaseProvider` that returns a composite key (`surfaceId:chatId`) when a surfaceId is provided, or just `chatId` when not. This enables multiple surfaces to run concurrent queries for the same chat without abort controller collisions.

Updated `query()` JSDoc to document new optional parameters: `surfaceId`, `systemPrompt`, `model`.

Updated `abort()` signature to accept an optional `surfaceId` parameter.

### Task 2: Update ClaudeProvider with surface-routed queries

Refactored `ClaudeProvider.query()` to support surface-routed configuration:

- **Surface config loading**: When `surfaceId` is provided, loads surface config via `getSurfaceConfig(surfaceId)` with graceful fallback on unknown surfaces
- **Three-tier merge priority**: explicit params > surface config > constructor defaults. Uses `||` for reference types and `??` for numerics to correctly handle `0` values
- **System prompt passthrough**: Surface config `systemPrompt` is passed to Agent SDK query options
- **Model passthrough**: Surface config `model` is passed to Agent SDK query options, overridable by explicit param
- **Permission mode**: Surface config `permissionMode` overrides constructor default
- **Composite abort keys**: Uses `getAbortKey(chatId, surfaceId)` for abort controller Map keys, enabling concurrent queries across surfaces
- **Bedrock env passthrough**: When `isBedrockConfigured()` returns true, merges `getBedrockEnv()` into query options `env` field so Agent SDK routes through AWS Bedrock

Fully backwards compatible: when `surfaceId` is omitted, all behavior matches the previous implementation exactly.

### Task 3: Update provider index with Bedrock status logging

Added `isBedrockConfigured` import and a log line in `initializeProviders()` that reports whether AWS Bedrock is configured, giving operators immediate visibility into the inference routing at startup.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Three-tier merge (explicit > surface > default) | Allows API callers to override surface defaults while surfaces provide sensible per-panel configuration |
| Graceful fallback on unknown surfaceId | Logs warning and uses constructor defaults rather than throwing, so callers don't need to validate surfaceId beforehand |
| Composite abort key format `surfaceId:chatId` | Simple string concatenation avoids Map key complexity while preventing collisions between surfaces |
| Bedrock env merged unconditionally when configured | If AWS credentials are present, always route through Bedrock; per-surface Bedrock opt-out can be added later if needed |

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 0d77c83 | feat(1-3): update BaseProvider with surfaceId support and getAbortKey helper |
| 6b48d8a | feat(1-3): add surface-routed queries and Bedrock env to ClaudeProvider |
| 7fa5527 | feat(1-3): log Bedrock configuration status in initializeProviders |

## Key Files

### Modified
- `server/providers/base-provider.js` - Added getAbortKey helper, surfaceId params to query/abort JSDoc
- `server/providers/claude-provider.js` - Surface config loading, Bedrock env, composite abort keys
- `server/providers/index.js` - Bedrock status logging in initializeProviders

### Referenced (not modified)
- `server/surfaces/index.js` - getSurfaceConfig used by ClaudeProvider
- `server/bedrock-env.js` - getBedrockEnv/isBedrockConfigured used by ClaudeProvider and index

## Verification

- `base-provider.js` parses and exports correctly via dynamic import
- `server/surfaces/index.js` and `server/bedrock-env.js` resolve and return expected values
- All three files committed with no syntax errors
- Backwards compatibility preserved: surfaceId is optional throughout
