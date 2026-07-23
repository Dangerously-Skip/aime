/**
 * Product branding — single source of truth.
 *
 * Quarry (nib internal) was renamed AIME for the open-source release.
 * Anything user-visible or model-visible must use these constants, never a
 * hardcoded product name; `branding.test.ts` guards the surface prompts.
 *
 * Infrastructure identifiers (storage-key prefix, data directory, Electron
 * appId) migrate in later P0 slices — see .planning/aime-roadmap.md.
 */

export const APP_NAME = 'AIME';

export const APP_DESCRIPTION = 'An open-source desktop AI workspace';
