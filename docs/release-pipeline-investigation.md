# Quarry Release Pipeline — Investigation & Roadblocks

**Date:** 2026-04-08
**Author:** Adam Witanowski + Claude
**Goal:** Automated, notarized release builds with internal download page + electron auto-updater

## Current State (working, but fragile)

The existing setup uses a Fargate nginx container that reverse-proxies to a CloudFront distribution, which fronts `s3://nib-kaos-secure-web-ap-southeast-2/quarry-releases/`. This works but is unnecessarily complex and exposes weird CloudFront URLs to users.

```
App (electron-updater)
  → quarry.internal.invalid (nginx on Fargate)
    → dfgpnvuiozlc8.cloudfront.net (CloudFront)
      → s3://nib-kaos-secure-web-ap-southeast-2/quarry-releases/
```

## Target Architecture

Replace the Fargate nginx with a SAMOA `RQP::StaticSite` — the standard nib pattern for static hosting. This gives us S3 + CloudFront + Route53 with zero containers to manage.

```
GitHub Actions (tag push)
  → Build + notarize macOS/Windows (~25 min)
  → Create GitHub Release with artifacts
  → Trigger Buildkite promote-release via API
      → Download artifacts
      → Bundle with landing page into content.zip
      → SAMOA deploy as RQP::StaticSite
          → S3 + CloudFront + Route53
          → quarry.internal.invalid
```

## Approaches Tried & Roadblocks

### Approach 1: GitHub Actions uploads to S3, Buildkite deploys from S3
**Idea:** GitHub Actions syncs release artifacts to an S3 staging prefix. Buildkite picks them up using `assume-deployer-role` — no tokens or credentials to share between systems.

**Roadblock:** GitHub Actions doesn't have AWS credentials.
- `AWS_PROMOTE_ACCESS_KEY_ID` / `AWS_PROMOTE_SECRET_ACCESS_KEY` secrets were referenced in the old workflow with `continue-on-error: true` but were **never actually created**.
- Tried to create an IAM user on account `384553929753` (dev/sandbox) — **`iam:CreateUser` denied** by PowerUser role.
- GitHub OIDC → IAM role is possible but **no nib repos use this pattern in production** (only exists in docs/test repos like `anson-gitworkflow` and `rqp-fis` docs). Would be pioneering it.

**Status:** Blocked on IAM access. Works if someone with IAM admin creates the user/role.

### Approach 2: Buildkite downloads from GitHub Release via PAT in secrets bucket
**Idea:** Store a GitHub fine-grained PAT (read-only, scoped to `redacted-org/quarry`) in the Buildkite secrets bucket `s3://nib-control-sensitive-buildkite-secrets/quarry-promote-release/GITHUB_TOKEN`.

**Roadblock:** The secrets bucket is on the control account (`441581275790`) and encrypted with a KMS key.
- `PutObject` denied: `kms:GenerateDataKey` not authorized for our role.
- `ListBucket` also denied — cross-account access restricted.
- Only the Buildkite infrastructure team / control account admins can write to this bucket.

**Status:** Blocked on control account access. Standard nib pattern but requires elevated permissions to set up.

### Approach 3: Set GITHUB_TOKEN as pipeline env var in Buildkite UI
**Idea:** Set the PAT directly in the Buildkite pipeline settings UI as an environment variable.

**Roadblock (partial):** The "Environment Variables" field wasn't visible on the pipeline settings page. Workaround: added the token to the pipeline YAML Steps configuration in the Buildkite UI instead.

**Status:** Currently deployed and being tested (build #6). Token is visible in the pipeline config (not encrypted) which is not ideal for long-term use.

### Approach 4: Buildkite API to set pipeline env var programmatically
**Idea:** Use `PATCH /pipelines/{slug}` to set `env.GITHUB_TOKEN` via the Buildkite API.

**Roadblock:** Buildkite API token doesn't have `write_pipelines` scope. Would need to regenerate the token with additional scopes.

**Status:** Would work with correct token scopes. Same concern as Approach 3 about token visibility.

## What's Deployed Now

- **SAM template:** Updated to `RQP::StaticSite` (replaces Fargate nginx)
- **GitHub Actions:** Builds, notarizes, creates GitHub Release, triggers Buildkite via API
- **Buildkite promote-release:** Downloads from GitHub Release (using PAT in step config), bundles with landing page, deploys via SAMOA
- **Buildkite API token:** Set as GitHub secret `BUILDKITE_API_TOKEN` with `read_builds` + `write_builds` scopes
- **GitHub PAT:** `quarry-buildkite-releases` — fine-grained, read-only, scoped to `redacted-org/quarry`, 90-day expiry
- **S3 quarry-releases:** Manually synced v1.0.26 artifacts so the existing site works while SAMOA migration completes

## Recommendations

### Short-term (get it working)
The current approach (PAT in Buildkite step config) works. It's not ideal for security but the token is read-only and scoped to a single repo.

### Medium-term (harden)
1. **Move the PAT to the Buildkite secrets bucket** — ask someone with control account access to run:
   ```bash
   echo -n "github_pat_..." | aws s3 cp - \
     s3://nib-control-sensitive-buildkite-secrets/quarry-promote-release/GITHUB_TOKEN
   ```
   The Buildkite agent hooks auto-export files from this path as env vars.

2. **Or set up GitHub OIDC → IAM role** for GitHub Actions to push to S3 directly, eliminating the need for a GitHub PAT on Buildkite entirely. This is the AWS-recommended approach and removes all stored credentials from the pipeline.

### Long-term (ideal)
GitHub OIDC → IAM role. Both GitHub Actions and Buildkite auth via IAM (no PATs, no stored keys). GitHub pushes to S3, Buildkite reads from S3 — both using short-lived IAM credentials. This is the industry standard for CI/CD → AWS integration.

## Key Files Changed

| File | Change |
|------|--------|
| `infrastructure/releases/sam_template.yaml` | `RQP::FargateTask/Service` → `RQP::StaticSite` |
| `infrastructure/releases/Dockerfile` | Deleted (no more nginx container) |
| `infrastructure/releases/nginx.conf` | Deleted |
| `.github/workflows/release.yml` | Added Buildkite trigger step after release creation |
| `.buildkite/pipeline.yml` | Simplified — SAMOA deploy only |
| `.buildkite/promote-release.yml` | Downloads from GitHub Release, bundles, SAMOA deploys |

## GitHub Secrets Required

| Secret | Purpose | Status |
|--------|---------|--------|
| `BUILDKITE_API_TOKEN` | Trigger promote-release pipeline | Set |
| `MAC_CERT_P12_BASE64` | macOS code signing | Set |
| `MAC_CERT_PASSWORD` | macOS cert password | Set |
| `APPLE_ID` | Notarization | Set |
| `APPLE_APP_SPECIFIC_PASSWORD` | Notarization | Set |
| `APPLE_TEAM_ID` | Notarization | Set |
| `DOT_ENV` | App environment config | Set |
| `TEAMS_JSON` | Team configuration | Set |
| `AWS_PROMOTE_ACCESS_KEY_ID` | S3 staging upload (Approach 1) | **Not set** |
| `AWS_PROMOTE_SECRET_ACCESS_KEY` | S3 staging upload (Approach 1) | **Not set** |

## Buildkite Pipeline Config

| Setting | Value |
|---------|-------|
| `GITHUB_TOKEN` | Set in Steps YAML (pipeline UI) — should be moved to secrets bucket |
| Scopes needed on Buildkite API token | `read_builds`, `write_builds` |
