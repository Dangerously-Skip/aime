import type { A2UIDocument } from '@/lib/a2ui/types';
import type { CanvasTemplate } from './types';
import { architectureTemplate } from './architecture';

/** Registry of all known canvas templates. */
export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  architectureTemplate as unknown as CanvasTemplate,
];

export function getCanvasTemplate(id: string): CanvasTemplate | undefined {
  return CANVAS_TEMPLATES.find((t) => t.id === id);
}

/** Available templates for a surface. */
export function getCanvasTemplatesForSurface(surfaceId: string): CanvasTemplate[] {
  return CANVAS_TEMPLATES.filter((t) => !t.surfaces || t.surfaces.length === 0 || t.surfaces.includes(surfaceId));
}

/**
 * Detect a templated canvas payload and expand it. If the input doesn't carry
 * a `templateId`, returns null so callers fall back to treating it as a raw
 * A2UIDocument.
 */
export function expandCanvasTemplate(input: unknown): A2UIDocument | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const templateId = typeof obj.templateId === 'string' ? obj.templateId : null;
  if (!templateId) return null;
  const template = getCanvasTemplate(templateId);
  if (!template) {
    console.warn('[canvas] Unknown templateId:', templateId);
    return null;
  }
  const templateInput = (obj.input ?? {}) as Record<string, unknown>;
  try {
    return template.render(templateInput);
  } catch (err) {
    console.error('[canvas] Template render failed:', templateId, err);
    return null;
  }
}

/** System-prompt fragment listing available templates so the agent can pick one. */
export function buildCanvasTemplatesPrompt(surfaceId: string): string {
  const templates = getCanvasTemplatesForSurface(surfaceId);
  if (templates.length === 0) return '';
  const lines = templates.map((t) =>
    `- **${t.id}** — ${t.name}. ${t.description}\n  When to use: ${t.whenToUse}\n  Input shape: ${t.inputShape}`
  );
  return `## Canvas templates

When you call the \`canvas\` tool, you can pass a templated payload:

\`\`\`json
{ "templateId": "<id>", "input": { ... } }
\`\`\`

Available templates:

${lines.join('\n\n')}

If none of the templates fit, you can still pass a raw A2UI document with \`{ "version": "1", "components": [...] }\`.`;
}

export type { CanvasTemplate };
