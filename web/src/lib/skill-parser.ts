/**
 * SKILL.md frontmatter parser and serializer.
 * Handles the simple YAML frontmatter format used by Claude Agent SDK skills.
 */

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  'allowed-tools'?: string[];
  model?: string;
  context?: string[];
  agent?: string;
  [key: string]: unknown;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

/**
 * Parse a SKILL.md file content into frontmatter and body.
 */
export function parseSkillMd(content: string): ParsedSkill {
  const trimmed = content.trim();

  // Check for YAML frontmatter delimiters
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();
  const frontmatter = parseSimpleYaml(yamlBlock);

  return { frontmatter, body };
}

/**
 * Serialize frontmatter and body back into SKILL.md format.
 */
export function serializeSkillMd(frontmatter: SkillFrontmatter, body: string): string {
  const yamlLines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      yamlLines.push(`${key}:`);
      for (const item of value) {
        yamlLines.push(`  - ${item}`);
      }
    } else if (typeof value === 'boolean') {
      yamlLines.push(`${key}: ${value}`);
    } else {
      yamlLines.push(`${key}: ${value}`);
    }
  }

  if (yamlLines.length === 0) {
    return body;
  }

  return `---\n${yamlLines.join('\n')}\n---\n\n${body}`;
}

/**
 * Simple YAML parser for flat key-value pairs with array support.
 * Handles the subset of YAML used in SKILL.md frontmatter.
 */
function parseSimpleYaml(yaml: string): SkillFrontmatter {
  const result: SkillFrontmatter = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    // Array item
    if (trimmedLine.startsWith('- ') && currentKey && currentArray) {
      currentArray.push(trimmedLine.slice(2).trim());
      continue;
    }

    // Flush any pending array
    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    // Key-value pair
    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmedLine.slice(0, colonIndex).trim();
    const rawValue = trimmedLine.slice(colonIndex + 1).trim();

    if (!rawValue) {
      // Empty value — could be start of an array
      currentKey = key;
      currentArray = [];
      continue;
    }

    // Parse value type
    if (rawValue === 'true') {
      result[key] = true;
    } else if (rawValue === 'false') {
      result[key] = false;
    } else if (/^\d+$/.test(rawValue)) {
      result[key] = parseInt(rawValue, 10);
    } else {
      // Strip surrounding quotes if present
      result[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }

  // Flush final array
  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}
