import type { CanvasTemplate } from './types';

interface ADRInput {
  /** ADR number (e.g. 17) — used to suggest the filename. */
  number?: number;
  title: string;
  /** "Proposed" | "Accepted" | "Deprecated" | "Superseded". */
  status?: string;
  /** Author name or git handle. */
  author?: string;
  /** Decision date (defaults to today). */
  date?: string;
  /** ADR sections — markdown-rendered. */
  context: string;
  decision: string;
  consequences: string;
  /** Optional alternatives considered. */
  alternatives?: string;
  /** Optional repo + path for the "Save to repo" action. */
  repo?: string;
  /** Path within the repo (e.g. "docs/adr/0017-feature-flags.md"). */
  path?: string;
  /** GitHub MCP create_or_update_file tool name. */
  saveTool?: string;
}

function buildAdrMarkdown(input: ADRInput): string {
  const today = input.date ?? new Date().toISOString().split('T')[0];
  const head = input.number ? `# ${input.number}. ${input.title}` : `# ${input.title}`;
  return [
    head,
    `**Date:** ${today}`,
    input.author ? `**Author:** ${input.author}` : null,
    input.status ? `**Status:** ${input.status}` : null,
    '',
    '## Context',
    input.context,
    '',
    '## Decision',
    input.decision,
    '',
    '## Consequences',
    input.consequences,
    input.alternatives ? '\n## Alternatives considered\n' + input.alternatives : null,
  ].filter(Boolean).join('\n');
}

export const decisionLogTemplate: CanvasTemplate<ADRInput> = {
  id: 'decision_log',
  name: 'ADR / decision log',
  description: 'Render an Architecture Decision Record (ADR) as formatted markdown with a Save-to-repo action that calls the GitHub MCP\'s create_or_update_file.',
  whenToUse:
    'When the user wants to capture a technical decision — reasoning, trade-offs, consequences. ' +
    'Help the user fill in context/decision/consequences (ask if missing), then call this template. ' +
    'Pass `repo`, `path` (e.g. "docs/adr/0017-feature-flags.md"), and `saveTool` (e.g. `mcp__aime-connector-github__create_or_update_file`) so the Save action wires up.',
  inputShape:
    '{ number?: number, title: string, status?: string, author?: string, date?: string, context: string, decision: string, consequences: string, alternatives?: string, repo?: string, path?: string, saveTool?: string }',
  render: (input) => {
    const md = buildAdrMarkdown(input);
    const components: import('@/lib/a2ui/types').A2UIComponent[] = [
      {
        type: 'stat',
        id: 'meta',
        stats: [
          ...(input.number !== undefined ? [{ label: 'ADR', value: `#${input.number}` }] : []),
          ...(input.status ? [{ label: 'Status', value: input.status }] : []),
          ...(input.author ? [{ label: 'Author', value: input.author }] : []),
          { label: 'Date', value: input.date ?? new Date().toISOString().split('T')[0] },
        ],
      },
      {
        type: 'markdown',
        id: 'adr-body',
        content: md,
      },
    ];

    if (input.saveTool && input.repo && input.path) {
      const [owner, repo] = input.repo.split('/');
      components.push({
        type: 'action-card',
        id: 'save',
        title: 'Commit to repo',
        description: `Save this ADR to **${input.repo}/${input.path}**.`,
        actions: [
          {
            actionId: `commit-adr`,
            label: '💾 Commit ADR',
            variant: 'primary',
            tool: input.saveTool,
            args: {
              owner,
              repo,
              path: input.path,
              content: md,
              message: `docs(adr): ${input.title}`,
              branch: 'main',
            },
            feedbackPrompt: `Commit ADR "${input.title}" to ${input.repo} at path ${input.path}. The branch should be a new feature branch off main; open a PR titled "docs(adr): ${input.title}" and link it back here.`,
          },
        ],
      });
    }

    return {
      version: '1',
      title: input.number !== undefined ? `ADR ${input.number}: ${input.title}` : input.title,
      components,
    };
  },
};
