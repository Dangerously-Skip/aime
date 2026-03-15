export interface ParsedArtifact {
  id: string;
  title: string;
  type: 'markdown' | 'code' | 'text' | 'html';
  language?: string;
  content: string;
}

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'artifact'; artifact: ParsedArtifact };

export interface ParsedMessage {
  segments: MessageSegment[];
}

/**
 * Regex to match :::artifact{title="..." type="..."} ... ::: blocks.
 * Supports optional `language="..."` attribute for code artifacts.
 */
const ARTIFACT_BLOCK_RE =
  /:::artifact\{([^}]+)\}\s*\n([\s\S]*?)\n:::/g;

const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function isValidType(t: string): t is ParsedArtifact['type'] {
  return ['markdown', 'code', 'text', 'html'].includes(t);
}

/**
 * Fallback heuristic: if no explicit markers found but the message is >80%
 * a single code fence with >20 lines, treat the entire fence as an implicit artifact.
 */
function tryFallbackCodeFence(content: string): ParsedMessage | null {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/^```(\w*)\n([\s\S]*?)\n```$/);
  if (!fenceMatch) return null;

  const fenceContent = fenceMatch[2];
  const lines = fenceContent.split('\n');
  if (lines.length < 20) return null;

  // Check if the fence represents >80% of the total content
  const fenceBlock = fenceMatch[0];
  if (fenceBlock.length / trimmed.length < 0.8) return null;

  const language = fenceMatch[1] || undefined;
  const artifact: ParsedArtifact = {
    id: `artifact_${Date.now()}_fallback`,
    title: language ? `${language} code` : 'Code',
    type: 'code',
    language,
    content: fenceContent,
  };

  // Any text before/after the fence
  const beforeIdx = content.indexOf(fenceBlock);
  const before = content.slice(0, beforeIdx).trim();
  const after = content.slice(beforeIdx + fenceBlock.length).trim();

  const segments: MessageSegment[] = [];
  if (before) segments.push({ type: 'text', content: before });
  segments.push({ type: 'artifact', artifact });
  if (after) segments.push({ type: 'text', content: after });

  return { segments };
}

/**
 * Parse assistant message content for artifact blocks.
 * Returns segments of text interspersed with extracted artifacts.
 */
export function parseArtifacts(messageContent: string): ParsedMessage {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  let matchCount = 0;

  // Reset regex state
  ARTIFACT_BLOCK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ARTIFACT_BLOCK_RE.exec(messageContent)) !== null) {
    matchCount++;

    // Text before this artifact block
    const textBefore = messageContent.slice(lastIndex, match.index).trim();
    if (textBefore) {
      segments.push({ type: 'text', content: textBefore });
    }

    const attrs = parseAttributes(match[1]);
    const artifactContent = match[2].trim();
    const artifactType = isValidType(attrs.type) ? attrs.type : 'markdown';

    const artifact: ParsedArtifact = {
      id: `artifact_${Date.now()}_${matchCount}`,
      title: attrs.title || 'Untitled',
      type: artifactType,
      language: attrs.language,
      content: artifactContent,
    };

    segments.push({ type: 'artifact', artifact });
    lastIndex = match.index + match[0].length;
  }

  // No markers found — try fallback heuristic
  if (matchCount === 0) {
    const fallback = tryFallbackCodeFence(messageContent);
    if (fallback) return fallback;

    // No artifacts at all
    return { segments: [{ type: 'text', content: messageContent }] };
  }

  // Remaining text after last artifact
  const trailing = messageContent.slice(lastIndex).trim();
  if (trailing) {
    segments.push({ type: 'text', content: trailing });
  }

  return { segments };
}

/**
 * Quick check whether content contains any artifact markers.
 * Cheaper than running the full parse.
 */
export function hasArtifactMarkers(content: string): boolean {
  return content.includes(':::artifact{');
}
