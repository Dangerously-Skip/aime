import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getChatConfig } from '@/lib/surfaces/chat-config';
import { getCoworkConfig } from '@/lib/surfaces/cowork-config';
import { getCodeConfig } from '@/lib/surfaces/code-config';

/**
 * Craft is a capability, not a surface feature.
 *
 * The rules for a printed invoice, a projected slide and a dashboard are
 * different and sometimes contradictory, but WHICH of them applies is decided by
 * what is being made — never by which tab the user happens to be in. Someone
 * asking Cowork for a PDF report and someone asking Code for one should get the
 * same document.
 *
 * The mechanism that delivers this is already the right one: the craft skills
 * install to `~/.claude/plugins/aime-skills`, which is global, and the model
 * picks between them by matching their descriptions. Nothing needs to be
 * per-surface. What DID need fixing is that the `Skill` tool was listed on chat
 * and cowork and not on code — the surface that actually builds UI — so the
 * skills existed and could not be loaded there.
 *
 * That gap is invisible by inspection, which is why it is asserted here rather
 * than described in a comment.
 */

const SKILLS_DIR = path.resolve(__dirname, '../../../resources/aime-skills/skills');

/** The surfaces that produce artifacts. Browser and assistant produce none. */
const PRODUCING_SURFACES = [
  ['chat', getChatConfig()],
  ['cowork', getCoworkConfig()],
  ['code', getCodeConfig()],
] as const;

describe('every artifact-producing surface can load a skill', () => {
  it.each(PRODUCING_SURFACES)('%s lists the Skill tool', (name, config) => {
    expect(
      config.allowedTools,
      `${name} cannot auto-approve Skill, so craft guidance silently never loads there`,
    ).toContain('Skill');
  });
});

describe('the craft skills are installed globally, not per surface', () => {
  const CRAFT = ['craft-web', 'craft-deck', 'craft-doc'];

  it.each(CRAFT)('%s ships in the installed skill bundle', (id) => {
    expect(fs.existsSync(path.join(SKILLS_DIR, id, 'SKILL.md'))).toBe(true);
  });

  /**
   * No surface may hardcode a craft skill by name. Doing so would reintroduce
   * exactly what this file exists to prevent: craft that works in one tab.
   * Selection is the model's job, driven by the descriptions.
   */
  it.each(PRODUCING_SURFACES)('%s does not hardcode a craft skill', (name, config) => {
    const prompt =
      typeof config.systemPrompt === 'string'
        ? config.systemPrompt
        : (config.systemPrompt?.append ?? '');
    for (const id of CRAFT) {
      expect(prompt, `${name} pins ${id}; craft must be chosen by the brief, not the tab`).not.toContain(
        id,
      );
    }
  });

  /**
   * Every medium the eval briefs cover needs a skill that claims it. A brief
   * shape with no corresponding guidance is a measurement of nothing — the eval
   * would report "no improvement" for output that was never given any rules.
   */
  it('covers the media the brief set measures', () => {
    const descriptions = CRAFT.map((id) =>
      fs.readFileSync(path.join(SKILLS_DIR, id, 'SKILL.md'), 'utf-8').slice(0, 600).toLowerCase(),
    ).join('\n');
    for (const medium of ['web', 'slide', 'print']) {
      expect(descriptions, `no craft skill claims ${medium}`).toContain(medium);
    }
  });
});
