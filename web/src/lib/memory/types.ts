export type MemoryCategory =
  | 'preference'    // "User prefers TypeScript with strict mode"
  | 'fact'          // "User works at Acme Corp on the payments team"
  | 'pattern'       // "User always wants tests with new features"
  | 'decision'      // "Chose Next.js App Router over Pages Router for dashboard project"
  | 'skill'         // "User is proficient with React, Zustand, Tailwind"
  | 'relationship'; // "User works with Sarah (designer) and Mike (PM)"

export type MemoryScope = 'global' | 'project';

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  scope: MemoryScope;
  projectId: string | null;
  tags: string[];
  confidence: number;           // 0-1 (explicit=1.0, auto-extracted=0.6-0.8)
  accessCount: number;
  lastAccessedAt: number;
  createdAt: number;
  updatedAt: number;
  supersededBy: string | null;  // Soft-replace instead of delete
  source: 'explicit' | 'auto';
}

export const MEMORY_CATEGORIES: { value: MemoryCategory; label: string }[] = [
  { value: 'preference', label: 'Preference' },
  { value: 'fact', label: 'Fact' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'decision', label: 'Decision' },
  { value: 'skill', label: 'Skill' },
  { value: 'relationship', label: 'Relationship' },
];

export function suggestCategory(content: string): MemoryCategory {
  const lower = content.toLowerCase();
  if (/prefer|like|want|always use|never use|style|format/i.test(lower)) return 'preference';
  if (/chose|decided|picked|selected|went with|opted/i.test(lower)) return 'decision';
  if (/always|usually|pattern|workflow|routine|habit/i.test(lower)) return 'pattern';
  if (/proficient|experienced|knows|skilled|familiar/i.test(lower)) return 'skill';
  if (/works with|team|colleague|manager|designer|reports to/i.test(lower)) return 'relationship';
  return 'fact';
}
