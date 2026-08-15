import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The html-deck skill must keep offering a supported way to embed video, and
 * must keep telling the agent not to open decks as bare files.
 *
 * Both rules exist because of one shipped deck. Asked for video, the agent found
 * no video layout among the 31 on offer, invented `.video-wrap` — a class with
 * no rules anywhere — and appended it to slides that were already full. The
 * layout collapsed. Separately, the deck was opened with `open <file>`, so all
 * nine YouTube frames returned Error 153 for a null origin.
 *
 * Prose in a SKILL.md cannot fail a build. This can.
 */
const SKILL_DIR = path.join(process.cwd(), 'resources', 'html-deck');
const css = fs.readFileSync(path.join(SKILL_DIR, 'assets', 'base.css'), 'utf8');
const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
const template = fs.readFileSync(
  path.join(SKILL_DIR, 'templates', 'single-page', 'video.html'),
  'utf8',
);

describe('the deck skill offers a real video layout', () => {
  it('defines the classes the template uses, so none is invented at generation time', () => {
    // Every class the template relies on must have rules. `.video-wrap` had
    // none, which is precisely why the slide blew out.
    for (const cls of ['video-stage', 'video-frame', 'video-caption', 'l-video', 'l-video-split']) {
      expect(css, `.${cls} has no CSS`).toContain(`.${cls}`);
    }
  });

  it('every class the template uses is defined in the CSS', () => {
    const used = new Set(
      [...template.matchAll(/class="([^"]+)"/g)]
        .flatMap((m) => m[1].split(/\s+/))
        .filter((c) => c.startsWith('l-') || c.startsWith('video')),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const cls of used) {
      expect(css, `template uses .${cls} but the CSS does not define it`).toContain(`.${cls}`);
    }
  });

  it('constrains the frame by HEIGHT with min-height:0, or it overflows the slide', () => {
    // A flex item defaults to min-height:auto and refuses to shrink below its
    // content. Without this the 16:9 box escapes a fixed-height slide — the
    // exact failure being guarded.
    const stage = /\.video-stage\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(stage).toContain('min-height:0');
    const frame = /\.video-frame\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(frame).toContain('aspect-ratio:16/9');
    expect(frame).toMatch(/max-width:100%/);
  });

  it('tells the agent not to append video to a full slide', () => {
    expect(skill.toLowerCase()).toMatch(/never append a player|do not append/i);
  });
});

describe('the deck skill opens decks over http', () => {
  it('no longer instructs a bare `open <file>` for the deck entry point', () => {
    expect(skill).not.toMatch(/^\s*open examples\/my-talk\/index\.html\s*$/m);
  });

  it('routes the quick start through /api/preview', () => {
    expect(skill).toContain('/api/preview');
  });

  it('says why, so the instruction survives someone tidying it', () => {
    expect(skill).toMatch(/Error 153|null origin|NULL ORIGIN/);
  });

  it('the template repeats the origin requirement where the iframes are', () => {
    expect(template).toMatch(/Error 153|NULL origin|null origin/i);
  });
});
