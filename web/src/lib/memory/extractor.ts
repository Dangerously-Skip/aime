import Anthropic from '@anthropic-ai/sdk';
import type { MemoryCategory } from './types';

/**
 * The model extraction falls back to when the caller names none.
 *
 * A hardcoded Anthropic id used to be the ONLY option, and it is wrong for
 * anyone not on Anthropic. `ANTHROPIC_BASE_URL` points at this app's llm-proxy,
 * so the id travelled to whatever provider the user configured and came back:
 *
 *   [llm-proxy] upstream 400: "claude-haiku-4-5-20251001 is not a valid model ID"
 *
 * — on every single turn, for an OpenRouter user, silently. Memory extraction
 * was simply dead for them, and the only trace was a 400 in a log nobody reads.
 *
 * This is the failure `resolveSendRoute` exists to prevent, in a file that never
 * called it: code that skips the chokepoint resolves against the built-in
 * Anthropic registry and then demands an Anthropic account.
 */
const FALLBACK_MODEL = process.env.MEMORY_EXTRACTION_MODEL || 'claude-haiku-4-5-20251001';

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the conversation turn and extract useful memories about the user.

Extract ONLY genuinely useful information — things that would help personalize future interactions. Focus on:
- User preferences (coding style, tools, frameworks)
- Facts about the user (role, company, team)
- Patterns (how they like to work, what they always want)
- Decisions made (technology choices, architecture decisions)
- Skills demonstrated or mentioned
- Relationships mentioned (colleagues, team members)

Rules:
- Only extract information explicitly stated or strongly implied
- Do not extract trivial or temporary information
- Each memory should be a single, clear statement
- Return an empty array if nothing worth remembering was said

Respond with a JSON array of objects:
[
  {
    "content": "User prefers TypeScript with strict mode",
    "category": "preference",
    "tags": ["typescript", "strict-mode"],
    "confidence": 0.8
  }
]

Categories: preference, fact, pattern, decision, skill, relationship
Confidence: 0.6 (inferred) to 0.8 (explicitly stated)`;

interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  tags: string[];
  confidence: number;
}

/**
 * Extract memories from a conversation turn using Haiku.
 * Returns extracted memories or empty array if none found.
 */
export async function extractMemories(
  userMessage: string,
  assistantResponse: string,
  apiKey?: string,
  /**
   * The model to extract with, resolved by the caller from the user's own
   * configuration. Extraction is a background nicety, so an unresolvable model
   * means "skip", never "fail the turn".
   */
  model?: string | null,
): Promise<ExtractedMemory[]> {
  // Skip trivial responses
  if (assistantResponse.length < 50) return [];

  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return [];

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: model || FALLBACK_MODEL,
      max_tokens: 1024,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: 'user',
          content: `User said: "${userMessage}"\n\nAssistant responded: "${assistantResponse.substring(0, 2000)}"`,
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    // Parse JSON array from response — find the first balanced [ ... ]
    const startIdx = text.indexOf('[');
    if (startIdx === -1) return [];
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') { depth--; if (depth === 0) { endIdx = i; break; } }
    }
    if (endIdx === -1) return [];

    const parsed = JSON.parse(text.slice(startIdx, endIdx + 1)) as ExtractedMemory[];

    // Validate and sanitize
    return parsed
      .filter(
        (m) =>
          m.content &&
          typeof m.content === 'string' &&
          m.content.length > 5 &&
          ['preference', 'fact', 'pattern', 'decision', 'skill', 'relationship'].includes(m.category)
      )
      .map((m) => ({
        content: m.content.trim(),
        category: m.category as MemoryCategory,
        tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string') : [],
        confidence: typeof m.confidence === 'number' ? Math.min(0.8, Math.max(0.6, m.confidence)) : 0.7,
      }));
  } catch (error) {
    console.error('[MEMORY] Extraction failed:', error);
    return [];
  }
}
