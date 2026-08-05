import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * The deck plugin must work from a fresh clone.
 *
 * It did not. `brands/default/pptx_config.yaml` pointed at
 * `Presentation_Template.pptx`, a proprietary asset that never made it into the
 * open-source repo — so `markdown_to_pptx.py` raised `Template not found` on
 * every machine except one that happened to have a leftover copy from before
 * the rename. The agent, reading that error, concluded the plugin was broken
 * and set about building a template itself.
 *
 * Same shape as the brand-guidelines palette, the internal SearXNG host and the
 * gateway URL: a nib-era artifact left behind as a dangling reference. This is
 * the check that a default depends only on what the project actually ships.
 *
 * The end-to-end proof — generating a real deck from a clean copy — is a Python
 * round trip and lives outside the JS suite; it was run by hand and produced a
 * 4-slide 1920x1080 deck with the expected layouts. What is checkable here is
 * the configuration that made it possible, and every clause below is one that
 * was wrong.
 */

const PLUGIN = path.resolve(__dirname, '../../../resources/ppt-plugin');
const DEFAULT_BRAND = path.join(PLUGIN, 'brands/default');

interface PptxConfig {
  template?: { path?: string; slide_width?: number; slide_height?: number };
  layouts?: Record<string, number>;
}

const config = yaml.load(
  fs.readFileSync(path.join(DEFAULT_BRAND, 'pptx_config.yaml'), 'utf-8'),
) as PptxConfig;

describe('the default brand ships everything it references', () => {
  /**
   * The bug itself. Any `template.path` here must resolve to a file in the
   * repo — otherwise the default brand is broken for everyone who clones it.
   */
  it('references no template file the repo does not contain', () => {
    const p = config.template?.path;
    if (!p) return; // no template is the supported default — see below
    const resolved = path.isAbsolute(p) ? p : path.join(DEFAULT_BRAND, p);
    expect(fs.existsSync(resolved), `default brand points at missing ${p}`).toBe(true);
  });

  it('has no template at all, so it depends on nothing binary', () => {
    expect(config.template?.path).toBeUndefined();
  });

  /**
   * With no template the converter uses python-pptx's built-in layout set, so
   * the indices have to address THAT set. An index past its end would put the
   * plugin back to failing, just later and less legibly.
   */
  it('maps layouts within the built-in set (0-8)', () => {
    const layouts = config.layouts ?? {};
    expect(Object.keys(layouts).length).toBeGreaterThan(0);
    for (const [name, idx] of Object.entries(layouts)) {
      expect(Number.isInteger(idx), `${name} is not an integer`).toBe(true);
      expect(idx, `${name} -> ${idx} is outside the built-in layouts`).toBeGreaterThanOrEqual(0);
      expect(idx, `${name} -> ${idx} is outside the built-in layouts`).toBeLessThanOrEqual(8);
    }
  });

  /**
   * `craft-deck` specifies 1920x1080. The config always said 13.33x7.5 and the
   * code only ever READ slide_width — never set it — which was invisible while
   * a 16:9 brand template supplied the size, and produced 4:3 decks the moment
   * the built-in default was used.
   */
  it('asks for 16:9, and the converter applies it', () => {
    expect(config.template?.slide_width).toBeCloseTo(13.33, 2);
    expect(config.template?.slide_height).toBeCloseTo(7.5, 2);

    const py = fs.readFileSync(path.join(PLUGIN, 'markdown_to_pptx.py'), 'utf-8');
    expect(py, 'slide size is configured but never applied').toMatch(
      /prs\.slide_width\s*=\s*Inches/,
    );
    expect(py).toMatch(/prs\.slide_height\s*=\s*Inches/);
  });
});

describe('a missing brand template costs the brand, not the feature', () => {
  const py = fs.readFileSync(path.join(PLUGIN, 'markdown_to_pptx.py'), 'utf-8');

  it('does not raise when the template is absent', () => {
    expect(py).not.toMatch(/raise FileNotFoundError\(f?"Template not found/);
  });

  it('falls back to the built-in default presentation', () => {
    expect(py).toMatch(/Presentation\(\)/);
  });

  it('does not treat a missing template as a CLI usage error', () => {
    expect(py).not.toMatch(/parser\.error\('Template must be specified/);
  });
});
