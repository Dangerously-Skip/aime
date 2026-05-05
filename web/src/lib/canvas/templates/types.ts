import type { A2UIDocument } from '@/lib/a2ui/types';

/**
 * A canvas template is a typed shortcut for producing an A2UIDocument.
 * Instead of authoring full A2UI JSON, the agent calls the existing `canvas`
 * tool with `{ templateId, input }`. The provider expands `input` via the
 * template's `render()` and emits the result as a canvas SSE event.
 *
 * Raw A2UI documents (no `templateId`) continue to work unchanged.
 */
export interface CanvasTemplate<TInput = Record<string, unknown>> {
  /** Stable identifier the agent uses in `templateId`. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** What this template is for, shown to the agent in the system prompt. */
  description: string;
  /** Triggers / examples that hint to the agent when to pick this template. */
  whenToUse: string;
  /** Surfaces where this template is offered. Empty array = all surfaces. */
  surfaces?: string[];
  /** Input shape (described in plain English for the agent — not a strict schema). */
  inputShape: string;
  /** Pure: input → fully-rendered A2UIDocument. */
  render: (input: TInput) => A2UIDocument;
}
