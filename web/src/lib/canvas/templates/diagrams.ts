import type { CanvasTemplate } from './types';

interface ERDiagramInput {
  title: string;
  /** Mermaid `erDiagram` source. */
  mermaid: string;
  notes?: string;
}

interface SequenceDiagramInput {
  title: string;
  /** Mermaid `sequenceDiagram` source. */
  mermaid: string;
  notes?: string;
}

interface MindmapInput {
  title: string;
  /** Mermaid `mindmap` source. */
  mermaid: string;
  notes?: string;
}

export const erDiagramTemplate: CanvasTemplate<ERDiagramInput> = {
  id: 'er_diagram',
  name: 'Entity-relationship diagram',
  description: 'Render a Mermaid `erDiagram` for database tables and their foreign-key relationships.',
  whenToUse: 'When the user asks to visualise a schema, table relationships, foreign keys, or data model. Always use Mermaid `erDiagram` syntax.',
  inputShape: '{ title: string, mermaid: string (Mermaid `erDiagram` source), notes?: string }',
  render: ({ title, mermaid, notes }) => ({
    version: '1',
    title,
    components: [
      { type: 'mermaid', id: 'er', title, code: mermaid },
      ...(notes ? [{ type: 'markdown' as const, id: 'notes', title: 'Notes', content: notes }] : []),
    ],
  }),
};

export const sequenceDiagramTemplate: CanvasTemplate<SequenceDiagramInput> = {
  id: 'sequence_diagram',
  name: 'Sequence diagram',
  description: 'Render a Mermaid `sequenceDiagram` for protocol flows, API calls, message exchanges between actors.',
  whenToUse: 'When the user asks for a sequence diagram, request/response flow, message ordering, or interaction trace between systems/actors.',
  inputShape: '{ title: string, mermaid: string (Mermaid `sequenceDiagram` source), notes?: string }',
  render: ({ title, mermaid, notes }) => ({
    version: '1',
    title,
    components: [
      { type: 'mermaid', id: 'seq', title, code: mermaid },
      ...(notes ? [{ type: 'markdown' as const, id: 'notes', title: 'Notes', content: notes }] : []),
    ],
  }),
};

export const mindmapTemplate: CanvasTemplate<MindmapInput> = {
  id: 'mindmap',
  name: 'Mind map',
  description: 'Render a Mermaid `mindmap` for hierarchical brainstorming, idea trees, taxonomies.',
  whenToUse: 'When the user asks for a mind map, brainstorm structure, hierarchical breakdown, or idea tree.',
  inputShape: '{ title: string, mermaid: string (Mermaid `mindmap` source), notes?: string }',
  render: ({ title, mermaid, notes }) => ({
    version: '1',
    title,
    components: [
      { type: 'mermaid', id: 'mindmap', title, code: mermaid },
      ...(notes ? [{ type: 'markdown' as const, id: 'notes', title: 'Notes', content: notes }] : []),
    ],
  }),
};
