import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { APP_NAME } from './branding';
import { getAvailableSurfaces, getSurfaceConfig } from '@/lib/surfaces';

/**
 * De-brand guard: the product is AIME (open source). Legacy identity strings
 * ("Quarry", "built by … nib", Bedrock claims) must never reappear in
 * model-visible surface prompts. The `.quarry` legacy data-dir token is the
 * only allowed remnant (migration-aware path filters).
 */
const INFRA_ALLOWLIST = [/\.quarry/g];

function promptTextFor(surfaceId: string): string {
  const config = getSurfaceConfig(surfaceId);
  let text = JSON.stringify(config.systemPrompt) + JSON.stringify(config.allowedTools ?? []);
  for (const allowed of INFRA_ALLOWLIST) {
    text = text.replace(allowed, '');
  }
  return text;
}

describe('branding guard', () => {
  it('every surface prompt identifies as the current product where it names itself', () => {
    for (const surfaceId of getAvailableSurfaces()) {
      const config = getSurfaceConfig(surfaceId);
      const prompt = JSON.stringify(config.systemPrompt);
      if (prompt.includes('You are ')) {
        expect(prompt, `${surfaceId} should introduce itself as ${APP_NAME}`).toContain(APP_NAME);
      }
    }
  });

  it('no surface prompt carries legacy Quarry/nib identity strings', () => {
    for (const surfaceId of getAvailableSurfaces()) {
      const text = promptTextFor(surfaceId);
      expect(text, `${surfaceId} mentions Quarry`).not.toMatch(/quarry/i);
      expect(text, `${surfaceId} mentions nib`).not.toMatch(/\bnib\b/i);
      expect(text, `${surfaceId} claims Bedrock inference`).not.toContain('Bedrock inference');
      expect(text, `${surfaceId} claims a corporate author`).not.toContain('built by the AI team');
    }
  });
});

/**
 * The surface-prompt guard above missed the leak that actually reached a user.
 *
 * A skill installed alongside the app carried a previous employer's brand, with
 * a description written to fire on ANY visual artifact — so "make me a landing
 * page" surfaced a corporate palette nobody asked for, and the agent offered it
 * as an available capability. The de-nib checklist reported complete because it
 * only ever checked prompts and constants.
 *
 * A repo test cannot police a user's `~/.claude/plugins`. What it CAN do is
 * guarantee this repository never ships the same problem — every file that goes
 * out with AIME, not just the prompts.
 */
const LEGACY = /\bquarry\b|\bnib\b/i;

/**
 * Deliberate legacy-compat remnants, listed in the roadmap's de-nib checklist as
 * "do not clean up". Each exists to READ data written by the previous product;
 * removing them orphans a real user's storage.
 */
const ALLOWED = [
  /nib-connector-/g,
  /nib-mcp-/g,
  /nibcowork/g,
  /persist:quarry/g,
  /\.quarry/g,
  /~\/\.quarry/g,
];

function shippedFiles(dir: string): string[] {
  const skip = new Set(['node_modules', '.next', 'dist', 'release', 'temp', '.git', 'evals']);
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (skip.has(e.name)) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return shippedFiles(full);
    /**
     * MARKDOWN only — skills, prompt docs, anything a model reads as
     * instructions.
     *
     * Scanning source as well was tried and produced 29 hits, every one
     * legitimate: a `__QUARRY_SELECTION_CLEAR__` sentinel, `nib-connector-`
     * config-key filters that exist to read old data, a list of obsolete skill
     * ids being REMOVED on install, a comment naming an internal CLI. A guard
     * that fires on all of those is one people learn to skip, and it would have
     * caught none of the leak it exists for — that was a skill description.
     */
    return /\.md$/.test(e.name) ? [full] : [];
  });
}

describe('nothing this repo ships carries the previous brand', () => {
  const ROOT = path.resolve(__dirname, '../..');
  /**
   * `resources/` is the one that mattered and was missed first time round.
   *
   * The leak was found in `~/.claude/plugins/…` and fixed there — but those are
   * INSTALLED COPIES. The source ships from `web/resources/`, gets copied out on
   * install, and would have overwritten the fix on the next launch while
   * continuing to ship the brand to every user. Guarding only what a developer
   * happens to be looking at is how it survived the de-nib checklist.
   */
  const roots = [
    path.join(ROOT, 'src'),
    path.join(ROOT, 'resources'),
    path.join(ROOT, '..', '.claude', 'skills'),
  ].filter((d) => fs.existsSync(d));
  const files = roots.flatMap(shippedFiles);

  it('scans a non-trivial number of files', () => {
    // Otherwise a broken path would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(1);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f] as const))(
    '%s',
    (rel, full) => {
      let text = fs.readFileSync(full, 'utf-8');
      for (const allowed of ALLOWED) text = text.replace(allowed, '');
      const hit = text.match(LEGACY);
      expect(
        hit,
        `${rel} carries the legacy brand ("${hit?.[0]}"). If it is a compat ` +
          `remnant that must read old data, add it to ALLOWED with a reason; ` +
          `otherwise remove it — an open-source user should never see it.`,
      ).toBeNull();
    },
  );
});
