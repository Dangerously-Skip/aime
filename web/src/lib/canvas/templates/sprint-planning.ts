import type { CanvasTemplate } from './types';
import type { KanbanCardAction } from '@/lib/a2ui/types';

interface PlanningIssue {
  key: string;
  title: string;
  description?: string;
  /** Story points estimate. */
  points?: number;
  /** Either 'backlog' or 'sprint'. */
  bucket: 'backlog' | 'sprint';
  /** Allowed transitions for moving the ticket between buckets. */
  url?: string;
  assignee?: string;
  priority?: 'low' | 'medium' | 'high';
  labels?: string[];
}

interface SprintPlanningInput {
  title: string;
  /** Sprint name (e.g. "Sprint 42 — 2026-05-12 → 2026-05-26"). */
  sprintName?: string;
  /** Capacity target in story points (e.g. team velocity). */
  capacityPoints?: number;
  /** Issues — each tagged as backlog or sprint. */
  issues: PlanningIssue[];
  /** Atlassian MCP transition tool name (for moving cards). */
  transitionTool?: string;
  /** Common args to merge with each transition call (e.g. cloudId). */
  baseToolArgs?: Record<string, unknown>;
  caption?: string;
}

function buildMoveAction(issue: PlanningIssue, transitionTool: string | undefined, baseToolArgs: Record<string, unknown>, target: 'backlog' | 'sprint'): KanbanCardAction[] {
  if (!transitionTool) return [];
  const label = target === 'sprint' ? '→ Sprint' : '→ Backlog';
  return [
    {
      actionId: `move-${issue.key}-${target}`,
      label,
      variant: target === 'sprint' ? 'primary' : 'secondary',
      tool: transitionTool,
      args: {
        ...baseToolArgs,
        issueIdOrKey: issue.key,
        // The agent must figure out the right transition id for the target
        // status — using the feedback prompt as a hint.
      },
      feedbackPrompt: `Move Jira issue ${issue.key} ${target === 'sprint' ? 'into' : 'out of'} the active sprint.`,
    },
  ];
}

export const sprintPlanningTemplate: CanvasTemplate<SprintPlanningInput> = {
  id: 'sprint_planning',
  name: 'Sprint planning',
  description: 'Two-column board (backlog vs sprint) with a capacity bar that tallies story points. Click a card to move it between buckets.',
  whenToUse:
    'When the user is planning a sprint — wants to see backlog vs. committed work, points totals, and move tickets in/out. ' +
    'Fetch backlog + sprint issues via the Atlassian MCP\'s search/sprint tools, tag each as `backlog` or `sprint`, include `points`. ' +
    'Pass `transitionTool` (full MCP name) so the move actions wire correctly.',
  inputShape:
    '{ title: string, sprintName?: string, capacityPoints?: number, issues: { key, title, description?, points?, bucket: "backlog"|"sprint", url?, assignee?, priority?, labels? }[], transitionTool?: string, baseToolArgs?: object, caption?: string }',
  render: ({ title, sprintName, capacityPoints, issues, transitionTool, baseToolArgs = {}, caption }) => {
    const safeIssues = Array.isArray(issues) ? issues : [];
    const sprintIssues = safeIssues.filter((i) => i.bucket === 'sprint');
    const backlogIssues = safeIssues.filter((i) => i.bucket === 'backlog');
    const sprintPoints = sprintIssues.reduce((s, i) => s + (i.points ?? 0), 0);
    const cap = capacityPoints ?? 0;
    const utilisation = cap > 0 ? Math.round((sprintPoints / cap) * 100) : 0;

    const cardForIssue = (i: PlanningIssue, target: 'backlog' | 'sprint') => ({
      id: i.key,
      title: `${i.key}: ${i.title}${i.points !== undefined ? ` (${i.points}pt)` : ''}`,
      description: i.description,
      labels: [
        ...(i.assignee ? [`@${i.assignee}`] : []),
        ...(i.labels ?? []),
      ],
      priority: i.priority,
      url: i.url,
      actions: buildMoveAction(i, transitionTool, baseToolArgs, target),
    });

    return {
      version: '1',
      title: title || (sprintName ? `Planning — ${sprintName}` : 'Sprint planning'),
      components: [
        {
          type: 'stat',
          id: 'capacity',
          stats: [
            { label: 'Sprint', value: `${sprintPoints} pts` },
            ...(cap > 0 ? [{ label: 'Capacity', value: `${cap} pts` }] : []),
            ...(cap > 0 ? [{
              label: 'Utilisation',
              value: `${utilisation}%`,
              trend: utilisation > 110 ? 'down' as const : utilisation > 90 ? 'neutral' as const : 'up' as const,
              trendValue: utilisation > 110 ? 'over capacity' : utilisation > 90 ? 'tight' : 'room to add',
            }] : []),
            { label: 'Backlog', value: `${backlogIssues.length} items` },
          ],
        },
        ...(cap > 0 ? [{
          type: 'progress' as const,
          id: 'capacity-bar',
          items: [{
            label: 'Sprint commitment vs capacity',
            value: Math.min(100, utilisation),
            color: utilisation > 110 ? '#ef4444' : utilisation > 90 ? '#f59e0b' : '#10b981',
          }],
        }] : []),
        {
          type: 'kanban',
          id: 'planning-board',
          columns: [
            { id: 'sprint', title: sprintName || 'Sprint', cards: sprintIssues.map((i) => cardForIssue(i, 'backlog')) },
            { id: 'backlog', title: 'Backlog', cards: backlogIssues.map((i) => cardForIssue(i, 'sprint')) },
          ],
        },
        ...(caption ? [{ type: 'markdown' as const, id: 'caption', content: caption }] : []),
      ],
    };
  },
};
