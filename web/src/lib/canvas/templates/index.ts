import type { A2UIDocument } from '@/lib/a2ui/types';
import type { CanvasTemplate } from './types';
import { architectureTemplate } from './architecture';
import { erDiagramTemplate, sequenceDiagramTemplate, mindmapTemplate } from './diagrams';
import { jiraKanbanTemplate } from './jira-kanban';
import { snowflakeSchemaTemplate } from './snowflake-schema';
import { githubPrTriageTemplate } from './github-pr-triage';
import { apiExplorerTemplate } from './api-explorer';
import { codeReviewTemplate } from './code-review';
import { buildPipelineTemplate } from './build-pipeline';

/** Registry of all known canvas templates. */
export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  architectureTemplate as unknown as CanvasTemplate,
  erDiagramTemplate as unknown as CanvasTemplate,
  sequenceDiagramTemplate as unknown as CanvasTemplate,
  mindmapTemplate as unknown as CanvasTemplate,
  jiraKanbanTemplate as unknown as CanvasTemplate,
  snowflakeSchemaTemplate as unknown as CanvasTemplate,
  githubPrTriageTemplate as unknown as CanvasTemplate,
  apiExplorerTemplate as unknown as CanvasTemplate,
  codeReviewTemplate as unknown as CanvasTemplate,
  buildPipelineTemplate as unknown as CanvasTemplate,
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
 *
 * On unknown templateId / render failure, returns a visible error doc rather
 * than null — silent empty panels are confusing.
 */
export function expandCanvasTemplate(input: unknown): A2UIDocument | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const templateId = typeof obj.templateId === 'string' ? obj.templateId : null;
  if (!templateId) return null;
  const template = getCanvasTemplate(templateId);
  if (!template) {
    console.warn('[canvas] Unknown templateId:', templateId);
    return makeErrorDoc(
      `Unknown canvas template: "${templateId}"`,
      `Available templates: ${CANVAS_TEMPLATES.map((t) => t.id).join(', ')}`,
    );
  }
  const templateInput = (obj.input ?? {}) as Record<string, unknown>;
  try {
    return template.render(templateInput);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[canvas] Template render failed:', templateId, err);
    return makeErrorDoc(
      `Could not render "${templateId}" canvas`,
      `**Error:** ${msg}\n\n**Input received:**\n\`\`\`json\n${JSON.stringify(templateInput, null, 2).slice(0, 800)}\n\`\`\``,
    );
  }
}

function makeErrorDoc(title: string, body: string): A2UIDocument {
  return {
    version: '1',
    title,
    components: [
      {
        type: 'markdown',
        id: 'error',
        content: body,
      },
    ],
  };
}

/** System-prompt fragment listing available templates so the agent can pick one. */
export function buildCanvasTemplatesPrompt(surfaceId: string): string {
  const templates = getCanvasTemplatesForSurface(surfaceId);
  if (templates.length === 0) return '';
  const lines = templates.map((t) =>
    `- **${t.id}** — ${t.name}. ${t.description}\n  When to use: ${t.whenToUse}\n  Input shape: ${t.inputShape}`
  );
  return `## Visualisations — you MUST call the canvas tool

For ANY visual artefact — diagrams, charts, kanban boards, schemas, dashboards, mind maps, sequence diagrams, PR/Jira/build/endpoint lists — you **must** call the \`mcp__quarry__canvas\` tool. The user sees nothing visual unless this tool fires.

### Hard rule (read this twice)

If you find yourself about to type any of these phrases:
  - "is up in the canvas"
  - "rendered in the canvas panel"
  - "shown in the canvas"
  - "is on the canvas"
  - "the canvas above/below shows"

…**STOP**. Either you have already called \`mcp__quarry__canvas\` in this turn, or you are about to lie to the user. Call the tool first; only mention the canvas in prose AFTER the tool call has succeeded.

### Do / don't

- ✅ Gather data → call \`mcp__quarry__canvas\` with a templated payload → write a 1–2 sentence summary referencing the canvas.
- ❌ Describe a visualisation in prose without calling the tool.
- ❌ Generate HTML/SVG files for diagrams or lists — the canvas panel renders them natively.

### Templated payload

\`\`\`json
{ "templateId": "<id>", "input": { ... } }
\`\`\`

Available templates:

${lines.join('\n\n')}

If none of the templates fit, pass a raw A2UI document: \`{ "version": "1", "components": [...] }\`.

If your data is too large to fit (e.g. a 200-endpoint OpenAPI spec), TRUNCATE — pick the 20 most relevant items and add a \`caption\` saying so. Do NOT skip the canvas call; partial data is always better than no canvas at all.

Reserve HTML artefacts for things the canvas can't render — interactive prototypes, full marketing pages, web app shells, custom games.`;
}

export type { CanvasTemplate };
