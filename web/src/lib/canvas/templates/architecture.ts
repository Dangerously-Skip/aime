import type { CanvasTemplate } from './types';

interface ArchitectureInput {
  title: string;
  /** Mermaid source — flowchart, graph, sequenceDiagram, etc. */
  mermaid: string;
  /** Optional caption shown below the diagram. */
  caption?: string;
  /** Optional notes rendered as markdown beneath the diagram. */
  notes?: string;
}

export const architectureTemplate: CanvasTemplate<ArchitectureInput> = {
  id: 'architecture',
  name: 'Architecture diagram',
  description: 'Render a Mermaid diagram (flowchart, graph, sequenceDiagram, classDiagram, mindmap, erDiagram) inside a polished canvas card.',
  whenToUse: 'When the user asks for an architecture diagram, system overview, flow chart, sequence diagram, mind map, or any visualisation expressible as Mermaid syntax.',
  inputShape: '{ title: string, mermaid: string (Mermaid source code), caption?: string, notes?: string (markdown) }',
  render: ({ title, mermaid, caption, notes }) => ({
    version: '1',
    title,
    components: [
      {
        type: 'mermaid',
        id: 'diagram',
        title,
        code: mermaid,
        caption,
      },
      ...(notes
        ? [
            {
              type: 'markdown' as const,
              id: 'notes',
              title: 'Notes',
              content: notes,
            },
          ]
        : []),
    ],
  }),
};
