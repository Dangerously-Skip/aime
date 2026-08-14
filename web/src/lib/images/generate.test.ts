import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateImage,
  extractImage,
  describeImageFailure,
  IMAGE_TIMEOUT_MS,
  DEFAULT_IMAGE_MODEL,
} from './generate';
import { themeArtDirection } from './art-direction';

/**
 * Generating pictures, for whatever is being built.
 *
 * The ask was general: "the image functionality would also be very handy if the
 * user is creating a mockup, app or website or document". So this is a tool on
 * the aime MCP server alongside SearchWeb and FetchUrl, not something wired into
 * the deck skill.
 *
 * The bar it has to clear is the same one every other outbound call here has:
 * bounded time, a failure the model can act on, and no path where the answer is
 * an invented URL.
 */

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

const respondWith = (body: unknown, status = 200): typeof fetch =>
  vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  }) as unknown as typeof fetch;

describe('reading the image out of a completion', () => {
  /**
   * Two shapes, both in the wild, and which one a model uses is not ours to
   * control. Handling only the documented one reports "no image was returned"
   * against a model that returned one.
   */
  it('finds it on message.images', () => {
    const got = extractImage({
      choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } }],
    });
    expect(got).toEqual({ mimeType: 'image/png', base64: PNG });
  });

  it('finds it in a content part', () => {
    const got = extractImage({
      choices: [
        { message: { content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PNG}` } }] } },
      ],
    });
    expect(got?.mimeType).toBe('image/jpeg');
  });

  it('returns null for a text-only reply rather than half an image', () => {
    expect(extractImage({ choices: [{ message: { content: 'I cannot draw that.' } }] })).toBeNull();
    expect(extractImage({})).toBeNull();
    expect(extractImage(null)).toBeNull();
  });
});

describe('generating one', () => {
  it('returns the image on success', async () => {
    const r = await generateImage({
      prompt: 'a wood-fired pizza oven',
      apiKey: 'sk-test',
      fetchImpl: respondWith({
        choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } }],
      }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.base64).toBe(PNG);
    expect(r.model).toBe(DEFAULT_IMAGE_MODEL);
  });

  it('asks for an image, not just text', async () => {
    const impl = respondWith({
      choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } }],
    });
    await generateImage({ prompt: 'x', apiKey: 'sk-test', fetchImpl: impl });
    const body = JSON.parse((impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // Without `modalities` the model answers in prose and this reports no-image.
    expect(body.modalities).toContain('image');
  });

  it('says so plainly when no credential is available, without calling out', async () => {
    const impl = vi.fn() as unknown as typeof fetch;
    const r = await generateImage({ prompt: 'x', apiKey: null, fetchImpl: impl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('not-configured');
    expect(impl).not.toHaveBeenCalled();
  });

  /** Same rule as every other outbound call: it must not be able to stall a turn. */
  it('is bounded well under the per-tool deadline', () => {
    expect(IMAGE_TIMEOUT_MS).toBeLessThan(180_000);
  });

  it('gives up rather than hanging', async () => {
    const impl = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' })) as unknown as typeof fetch;
    const r = await generateImage({ prompt: 'x', apiKey: 'sk-test', fetchImpl: impl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('timeout');
  });

  /**
   * A safety refusal is not a transient fault. Retrying it burns money and time
   * for a guaranteed second refusal; only rewording helps.
   */
  it('separates a refusal from a failure', async () => {
    const r = await generateImage({
      prompt: 'x',
      apiKey: 'sk-test',
      fetchImpl: respondWith('{"error":"blocked by safety policy"}', 400),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('refused');
  });

  it('reports a model that returns prose instead of a picture', async () => {
    const r = await generateImage({
      prompt: 'x',
      apiKey: 'sk-test',
      fetchImpl: respondWith({ choices: [{ message: { content: 'here is a description' } }] }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('no-image');
  });
});

/**
 * Every failure ends at the placeholder. The three alternatives are all worse:
 * an invented URL renders broken, a silent omission makes the layout look
 * intentionally empty, and a retry loop spends money on the same refusal.
 */
describe('what the agent is told when it cannot have an image', () => {
  it.each(['not-configured', 'timeout', 'upstream', 'no-image', 'refused'] as const)(
    'sends it to the placeholder on %s',
    (kind) => {
      const msg = describeImageFailure(kind, 'detail');
      expect(msg).toContain('.img-placeholder');
      expect(msg).toMatch(/do not invent an image URL/i);
    },
  );

  it('caps retries, since a refusal will refuse again', () => {
    expect(describeImageFailure('refused', '')).toMatch(/not retry more than once/i);
  });
});

/**
 * The consistency half, which is the whole reason this beats a stock photo. An
 * image that merely EXISTS fights the design.
 */
describe('art direction comes from the theme itself', () => {
  it('carries the theme’s real palette into the prompt', () => {
    const d = themeArtDirection('magazine-bold');
    expect(d, 'magazine-bold has a theme file').not.toBeNull();
    // Read from the CSS, not from a table that can drift from it.
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'resources/html-deck/assets/themes/magazine-bold.css'),
      'utf-8',
    );
    const accent = /--accent\s*:\s*([^;]+);/.exec(css)![1].trim();
    expect(d!.palette).toContain(accent);
    expect(d!.instruction).toContain(accent);
  });

  it('gives a different look to a different theme', () => {
    const a = themeArtDirection('neo-brutalism')!.instruction;
    const b = themeArtDirection('editorial-serif')!.instruction;
    expect(a).not.toBe(b);
    expect(a).toMatch(/hard edges|flat shapes/i);
    expect(b).toMatch(/photographic|documentary/i);
  });

  /**
   * The two things a generated image does by default that make it unusable
   * inside a slide layout.
   */
  it('forbids baked-in text and mockup chrome', () => {
    const d = themeArtDirection('aurora')!;
    expect(d.instruction).toMatch(/no text|no .*letters/i);
    expect(d.instruction).toMatch(/no borders|no .*frames/i);
  });

  it('refuses to invent a look for a theme that does not exist', () => {
    // Substituting a default aesthetic is how the model's own taste quietly
    // becomes the house style.
    expect(themeArtDirection('not-a-real-theme')).toBeNull();
    expect(themeArtDirection(null)).toBeNull();
  });

  it('cannot be pointed outside the theme directory', () => {
    expect(themeArtDirection('../../../package.json')).toBeNull();
    expect(themeArtDirection('../base')).toBeNull();
  });

  it('every shipped theme yields usable direction', () => {
    const dir = path.resolve(process.cwd(), 'resources/html-deck/assets/themes');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.css'))) {
      const d = themeArtDirection(f.replace('.css', ''));
      expect(d, `${f} produced no direction`).not.toBeNull();
      expect(d!.palette.length, `${f} contributed no palette`).toBeGreaterThan(0);
    }
  });
});

/**
 * The tool has to be reachable and bounded, not merely defined. Two ways this
 * ships broken without anything failing:
 *
 *   - a tool profile that omits it, so the model silently falls back to an
 *     invented URL (the `TOOL_PROFILES` trap this codebase has hit twice — with
 *     search, and then with the profiles' own web tools)
 *   - no cap, so a fourteen-slide deck with a picture per slide spends real
 *     money in a loop nobody is watching
 */
describe('the tool is reachable and capped', () => {
  const provider = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/providers/claude-provider.ts'),
    'utf-8',
  );

  it('is registered on the aime MCP server', () => {
    expect(provider).toMatch(/'CreateImage'/);
  });

  it('has a per-turn budget that is actually enforced', () => {
    expect(provider, 'no budget constant').toMatch(/IMAGE_BUDGET\s*=\s*\d+/);
    expect(
      provider,
      'the budget is declared but never checked — an uncapped loop spends real money',
    ).toMatch(/imagesUsed\(\)\s*>=\s*IMAGE_BUDGET/);
  });

  /*
   * And the count spans the whole TURN, not one query. The counter used to be a
   * local, which was right until the route learned to resume: a turn is up to
   * four `query()` calls, each with a fresh closure, so the cap that says "for
   * this turn" bounded 64 images while reporting 16/16 at each leg.
   */
  it('counts images per turn, so a resume cannot reset the cap', () => {
    expect(provider, 'the count is a per-query local again').not.toMatch(
      /let\s+imagesGenerated\s*=\s*0/,
    );
    expect(provider).toMatch(/imagesThisTurn/);
    expect(provider, 'a resume leg clears the count').toMatch(
      /if\s*\(!params\.isResume\)\s*this\.imagesThisTurn\.delete/,
    );
  });

  it('borrows the credential server-side rather than taking one from the request', () => {
    // The secret must not travel through settings or the request body; this is
    // the same borrowing `withStoredCredential` does for search.
    expect(provider).toMatch(/getCredentialStore\(\)\.getField\([\s\S]{0,60}'apiKey'\)/);
  });

  it('is offered by the profile that builds pages and documents', () => {
    const route = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/chat/[surfaceId]/route.ts'),
      'utf-8',
    );
    const coding = /coding:\s*\[([\s\S]*?)\],/.exec(route)?.[1] ?? '';
    expect(coding, 'the coding profile withholds CreateImage').toContain('mcp__aime__CreateImage');
  });
});

/**
 * A tool nobody is told about is a tool nobody calls.
 *
 * `CreateImage` shipped working — verified against the live API — and then a
 * whole deck run finished with no pictures and nothing in the log to explain it.
 * The tool had been advertised in exactly ONE place: inside `themeInstruction`,
 * which only emits when a deck theme is set. So it was invisible for a deck that
 * came out as pptx, and invisible for every mockup, page and document, which is
 * the general case it was built for.
 *
 * The tool description alone is not the answer. The model sees dozens of tools;
 * what makes it reach for one is the system prompt saying this kind of work
 * wants a picture.
 */
describe('the model is told the tool exists', () => {
  it('advertises it without needing a deck theme', async () => {
    const { imageInstruction } = await import('./prompt');
    const text = imageInstruction(true);
    expect(text, 'nothing tells the model image generation is possible').toContain('CreateImage');
    // The general cases, which is the whole point of it not being deck-gated.
    expect(text).toMatch(/mockup/i);
    expect(text).toMatch(/page|landing/i);
  });

  it('stays quiet when there is no credential to generate with', async () => {
    const { imageInstruction } = await import('./prompt');
    // Advertising a tool that will fail spends a turn discovering what we knew.
    expect(imageInstruction(false)).toBe('');
  });

  it('carries both absolute rules', async () => {
    const { imageInstruction } = await import('./prompt');
    const text = imageInstruction(true);
    expect(text, 'no rule against invented URLs').toMatch(/never invent an image url/i);
    expect(text, 'no placeholder fallback').toMatch(/placeholder/i);
  });

  it('the deck skill mentions it too, since that is what the model follows', () => {
    const skill = fs.readFileSync(
      path.resolve(process.cwd(), 'resources/aime-skills/skills/deck-html/SKILL.md'),
      'utf-8',
    );
    expect(skill, 'the deck skill never mentions generating images').toContain('CreateImage');
    expect(skill).toContain('img-placeholder');
  });
});

/**
 * Where the document goes decides whether the image resolves.
 *
 * The tool said: embed `src="images/x.png"` "relative to the file you are
 * writing" — while having no idea where that would be. A deck was written to the
 * home directory, the images were in the scratch directory, and every `<img>`
 * was broken. The relative form is right (a deck must survive being moved with
 * its folder); the assumption that the document lands beside it was not stated,
 * so it did not hold.
 */
describe('the image tool says where the document must go', () => {
  const provider = () =>
    fs.readFileSync(path.resolve(process.cwd(), 'src/lib/providers/claude-provider.ts'), 'utf-8');

  it('names the directory, not just the relative path', () => {
    const src = provider();
    const result = /Saved to \$\{abs\}[\s\S]{0,700}/.exec(src)?.[0] ?? '';
    expect(result, 'the success message does not exist in the expected form').not.toBe('');
    expect(result, 'the message never names the directory to write into').toMatch(
      /Write your document into \$\{dirAbs\}/,
    );
  });

  it('warns against the two places it actually went wrong', () => {
    const result = /Saved to \$\{abs\}[\s\S]{0,700}/.exec(provider())?.[0] ?? '';
    expect(result).toMatch(/home directory/i);
    expect(result).toMatch(/images\/\$\{safe\}\.\$\{ext\}/);
  });
});
