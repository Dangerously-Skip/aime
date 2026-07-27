import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  serializeVoiceProfile,
  parseVoiceProfile,
  buildVoicePrompt,
  hasVoice,
  VOICE_SECTIONS,
  voiceSectionHeading,
} from './voice';

const FULL = {
  tone: 'Dry and direct. Never chummy.',
  'sentence-rhythm': 'Short sentences, 10-14 words. Occasional one-word paragraph.',
  vocabulary: 'Plain Anglo-Saxon words. No consultant-speak.',
  structure: 'Answer first, then the reasoning. Close without a summary.',
  avoid: 'Semicolons, "I hope this finds you well", exclamation marks.',
};

describe('serialize / parse round-trip', () => {
  it('round-trips a full profile', () => {
    expect(parseVoiceProfile(serializeVoiceProfile(FULL))).toEqual(FULL);
  });

  it('round-trips a partial profile without inventing sections', () => {
    const partial = { tone: 'Blunt.', avoid: 'Adverbs.' };
    const md = serializeVoiceProfile(partial);
    expect(md).not.toContain('Vocabulary');
    expect(parseVoiceProfile(md)).toEqual(partial);
  });

  it('produces nothing at all for an empty profile', () => {
    expect(serializeVoiceProfile({})).toBe('');
    expect(serializeVoiceProfile({ tone: '   ' })).toBe('');
  });

  it('writes readable Markdown a person can edit by hand', () => {
    const md = serializeVoiceProfile({ tone: 'Dry.' });
    expect(md).toContain('# Writing voice');
    expect(md).toContain('## Tone');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('keeps multi-line and list content intact', () => {
    const profile = { avoid: '- Semicolons\n- Exclamation marks\n\n- Rhetorical questions' };
    expect(parseVoiceProfile(serializeVoiceProfile(profile))).toEqual(profile);
  });

  it('ignores headings it does not recognise rather than breaking', () => {
    // The file is user-editable; someone adding their own notes must not break it.
    const md = `# Writing voice\n\n## Tone\n\nDry.\n\n## My own notes\n\nwhatever\n`;
    expect(parseVoiceProfile(md)).toEqual({ tone: 'Dry.' });
  });

  it('is case-insensitive about headings', () => {
    expect(parseVoiceProfile('## tone\n\nDry.\n')).toEqual({ tone: 'Dry.' });
    expect(parseVoiceProfile('## NEVER DO THIS\n\nAdverbs.\n')).toEqual({ avoid: 'Adverbs.' });
  });

  it('handles empty, whitespace and non-string input', () => {
    for (const input of ['', '   ', undefined, null, 42]) {
      expect(parseVoiceProfile(input as unknown as string)).toEqual({});
    }
  });

  it('handles CRLF line endings', () => {
    expect(parseVoiceProfile('## Tone\r\n\r\nDry.\r\n')).toEqual({ tone: 'Dry.' });
  });

  it('property: serialize → parse is lossless for trimmed values', () => {
    const sectionArb = fc.record(
      Object.fromEntries(
        VOICE_SECTIONS.map((s) => [
          s,
          fc.option(
            fc
              .string({ minLength: 1 })
              // exclude content that would itself look like a heading
              .filter((v) => v.trim() !== '' && !/^#/m.test(v) && v.trim() === v),
            { nil: undefined },
          ),
        ]),
      ) as never,
    );
    fc.assert(
      fc.property(sectionArb, (profile) => {
        const cleaned = Object.fromEntries(
          Object.entries(profile as Record<string, string | undefined>).filter(([, v]) => v),
        );
        expect(parseVoiceProfile(serializeVoiceProfile(cleaned))).toEqual(cleaned);
      }),
      { numRuns: 300 },
    );
  });
});

describe('hasVoice', () => {
  it('is false for empty or whitespace-only profiles', () => {
    expect(hasVoice({})).toBe(false);
    expect(hasVoice({ tone: '' })).toBe(false);
    expect(hasVoice({ tone: '  \n ' })).toBe(false);
  });

  it('is true as soon as one section has content', () => {
    expect(hasVoice({ avoid: 'Adverbs.' })).toBe(true);
  });
});

describe('buildVoicePrompt', () => {
  it('returns empty for an empty profile so callers can append blindly', () => {
    expect(buildVoicePrompt({})).toBe('');
  });

  it('scopes the voice to the user\'s own prose, not the assistant\'s replies', () => {
    // Without this boundary the profile bleeds into conversation and the
    // assistant starts impersonating the user while talking to them.
    const p = buildVoicePrompt(FULL);
    expect(p).toMatch(/the USER will send, publish or put their name to/);
    expect(p).toMatch(/keep your own voice for talking to them/i);
  });

  it('includes every populated section under its heading', () => {
    const p = buildVoicePrompt(FULL);
    for (const section of VOICE_SECTIONS) {
      expect(p, section).toContain(voiceSectionHeading(section));
      expect(p, section).toContain(FULL[section]);
    }
  });

  it('omits sections that are not set', () => {
    const p = buildVoicePrompt({ tone: 'Dry.' });
    expect(p).toContain('Tone');
    expect(p).not.toContain('Vocabulary');
  });

  it('tells the agent an explicit request wins over the profile', () => {
    // Otherwise a user asking for "something formal for the board" gets their
    // usual voice anyway and has to argue with it.
    expect(buildVoicePrompt(FULL)).toMatch(/follow the request and say you have departed/i);
  });
});
