/**
 * Writing voice profile (P4).
 *
 * SOUL.md is who the assistant *is*; USER.md is who the user is. Neither says
 * how prose the user will put their name to should read — so every draft comes
 * back in the model's house style and the user rewrites it. A voice profile is
 * the missing third file: a compact, explicit description of the user's own
 * writing, injected like the others.
 *
 * Deliberately a small fixed set of dimensions rather than free text. "Write
 * like me" is uselessly vague to a model; "sentences average 12 words, no
 * semicolons, never open with 'I hope this finds you well'" is actionable. The
 * fixed shape also means the profile can be generated from writing samples and
 * then edited by hand without becoming unparseable.
 *
 * Stored as Markdown so a user can read and edit it in any editor — the same
 * reasoning as SOUL.md and USER.md. Pure: serialising and parsing only.
 */

/** The dimensions a model can actually act on. Order is the document order. */
export const VOICE_SECTIONS = [
  'tone',
  'sentence-rhythm',
  'vocabulary',
  'structure',
  'avoid',
] as const;

export type VoiceSection = (typeof VOICE_SECTIONS)[number];

const SECTION_HEADINGS: Record<VoiceSection, string> = {
  tone: 'Tone',
  'sentence-rhythm': 'Sentence rhythm',
  vocabulary: 'Vocabulary',
  structure: 'Structure',
  avoid: 'Never do this',
};

const SECTION_HINTS: Record<VoiceSection, string> = {
  tone: 'How it should feel to read — warm, blunt, wry, formal.',
  'sentence-rhythm': 'Typical sentence and paragraph length, and how much they vary.',
  vocabulary: 'Words and phrases characteristic of this writer; register and jargon level.',
  structure: 'How a piece opens, orders its points, and closes.',
  avoid: 'Constructions, clichés and habits to stay away from.',
};

export type VoiceProfile = Partial<Record<VoiceSection, string>>;

const HEADING_TO_SECTION = new Map<string, VoiceSection>(
  VOICE_SECTIONS.map((s) => [SECTION_HEADINGS[s].toLowerCase(), s]),
);

/** Empty sections are dropped, so a partly-filled profile stays honest. */
export function serializeVoiceProfile(profile: VoiceProfile): string {
  const parts: string[] = ['# Writing voice', ''];
  let any = false;

  for (const section of VOICE_SECTIONS) {
    const value = profile[section]?.trim();
    if (!value) continue;
    any = true;
    parts.push(`## ${SECTION_HEADINGS[section]}`, '', value, '');
  }

  if (!any) return '';
  return `${parts.join('\n').trimEnd()}\n`;
}

/**
 * Read a profile back. Unknown headings are ignored rather than rejected: the
 * file is user-editable, and someone adding their own notes must not break it.
 */
export function parseVoiceProfile(markdown: string): VoiceProfile {
  const profile: VoiceProfile = {};
  if (typeof markdown !== 'string' || markdown.trim() === '') return profile;

  let current: VoiceSection | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      const body = buffer.join('\n').trim();
      if (body) profile[current] = body;
    }
    buffer = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      flush();
      current = HEADING_TO_SECTION.get(heading[1].toLowerCase()) ?? null;
      continue;
    }
    // A level-1 heading ends any section (it's the document title).
    if (/^#\s+/.test(line)) {
      flush();
      current = null;
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();

  return profile;
}

/** True when there is anything worth injecting. */
export function hasVoice(profile: VoiceProfile): boolean {
  return VOICE_SECTIONS.some((s) => !!profile[s]?.trim());
}

/**
 * The system-prompt fragment.
 *
 * Scoped explicitly to prose the user will send or publish. Without that
 * boundary a voice profile bleeds into the assistant's own conversational
 * replies, which is not what the user asked for — they want their *drafts* to
 * sound like them, not the assistant to impersonate them while talking to them.
 */
export function buildVoicePrompt(profile: VoiceProfile): string {
  if (!hasVoice(profile)) return '';

  const lines: string[] = [
    '## The user\'s writing voice',
    '',
    'When you draft prose the USER will send, publish or put their name to — ' +
      'emails, documents, posts, messages — match the voice described below. ' +
      'It describes THEIR writing, not yours: keep your own voice for talking to ' +
      'them, for explanations, and for anything they have not asked you to draft.',
    '',
  ];

  for (const section of VOICE_SECTIONS) {
    const value = profile[section]?.trim();
    if (!value) continue;
    lines.push(`**${SECTION_HEADINGS[section]}** — ${value}`, '');
  }

  lines.push(
    'If a request conflicts with this voice, follow the request and say you have ' +
      'departed from the usual voice.',
  );

  return lines.join('\n');
}

/** Hints for the settings editor and for the generation prompt. */
export function voiceSectionHint(section: VoiceSection): string {
  return SECTION_HINTS[section];
}

export function voiceSectionHeading(section: VoiceSection): string {
  return SECTION_HEADINGS[section];
}
