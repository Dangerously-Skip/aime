import { describe, it, expect } from 'vitest';
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
