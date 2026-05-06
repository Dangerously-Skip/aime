import type { CanvasTemplate } from './types';
import type { KanbanCardAction } from '@/lib/a2ui/types';

interface TriageIssue {
  key: string;
  title: string;
  description?: string;
  status: string;
  priority?: 'low' | 'medium' | 'high';
  age?: string;
  url?: string;
  assignee?: string;
  reporter?: string;
  labels?: string[];
}

interface IssueTriageInput {
  title: string;
  /** Source — "Jira" or "Linear" — for context. */
  source?: string;
  /** Atlassian cloudId (Jira) or workspace id (Linear). */
  cloudId?: string;
  issues: TriageIssue[];
  /** Full MCP tool name for transitionJiraIssue / Linear updateIssue. */
  transitionTool?: string;
  /** Full MCP tool name for adding labels. */
  addLabelTool?: string;
  /** Full MCP tool name for assigning. */
  assignTool?: string;
  /** Full MCP tool name for closing. */
  closeTool?: string;
  baseToolArgs?: Record<string, unknown>;
  caption?: string;
}

function buildTriageActions(
  issue: TriageIssue,
  tools: { transition?: string; close?: string; assign?: string },
  baseArgs: Record<string, unknown>,
): KanbanCardAction[] {
  const actions: KanbanCardAction[] = [];

  if (tools.assign) {
    actions.push({
      actionId: `assign-${issue.key}`,
      label: '👤 Assign me',
      variant: 'secondary',
      tool: tools.assign,
      args: { ...baseArgs, issueIdOrKey: issue.key, assignee: 'self' },
      feedbackPrompt: `Assign Jira issue ${issue.key} to the current user.`,
    });
  }

  if (tools.transition) {
    actions.push({
      actionId: `start-${issue.key}`,
      label: '▶ Start',
      variant: 'primary',
      tool: tools.transition,
      args: { ...baseArgs, issueIdOrKey: issue.key },
      feedbackPrompt: `Transition Jira issue ${issue.key} to "In Progress". Look up the right transition id first.`,
    });
  }

  if (tools.close) {
    actions.push({
      actionId: `close-${issue.key}`,
      label: '✗ Close',
      variant: 'destructive',
      tool: tools.close,
      args: { ...baseArgs, issueIdOrKey: issue.key },
      feedbackPrompt: `Close (transition to Done / Won't Do) Jira issue ${issue.key}. Ask the user briefly which resolution.`,
    });
  }

  // Always offer a "discuss" feedback action so the user can engage the agent.
  actions.push({
    actionId: `discuss-${issue.key}`,
    label: '💬 Look at it',
    variant: 'secondary',
    feedbackPrompt: `Help the user investigate ${issue.key}. Read the issue body and comments via the Jira/Linear MCP, then summarise + suggest next steps.`,
  });

  return actions;
}

export const issueTriageTemplate: CanvasTemplate<IssueTriageInput> = {
  id: 'issue_triage',
  name: 'Issue triage queue',
  description: 'Render an unassigned/incoming issue queue (Jira or Linear) with one-click assign / start / close actions per row.',
  whenToUse:
    'When the user wants to triage their inbox of unassigned or freshly-reported issues. ' +
    'Fetch ~20 most recent unassigned issues from the relevant MCP, sort by age. ' +
    'Pass `transitionTool`, `closeTool`, `assignTool` (full MCP names), plus `cloudId` in `baseToolArgs` so per-card actions wire correctly.',
  inputShape:
    '{ title, source?, cloudId?, issues: { key, title, description?, status, priority?, age?, url?, assignee?, reporter?, labels? }[], transitionTool?, addLabelTool?, assignTool?, closeTool?, baseToolArgs?, caption? }',
  render: ({ title, source, cloudId, issues, transitionTool, assignTool, closeTool, baseToolArgs = {}, caption }) => {
    const safeIssues = Array.isArray(issues) ? issues : [];
    const baseArgs = { ...baseToolArgs, ...(cloudId ? { cloudId } : {}) };

    if (safeIssues.length === 0) {
      return {
        version: '1',
        title: title || 'Issue triage',
        components: [{
          type: 'markdown',
          id: 'empty',
          content: '_No issues to triage. Either you\'re all caught up, or the upstream call returned nothing — try scoping the query to a project._',
        }],
      };
    }

    return {
      version: '1',
      title: title || `Triage — ${source ?? 'Issues'}`,
      components: [
        {
          type: 'stat',
          id: 'overview',
          stats: [
            { label: 'Source', value: source ?? 'Jira' },
            { label: 'Open', value: safeIssues.length },
            { label: 'High pri', value: safeIssues.filter((i) => i.priority === 'high').length },
            { label: 'Unassigned', value: safeIssues.filter((i) => !i.assignee).length },
          ],
        },
        {
          type: 'kanban',
          id: 'triage-board',
          columns: [
            {
              id: 'inbox',
              title: 'Inbox',
              cards: safeIssues.map((i) => ({
                id: i.key,
                title: `${i.key}: ${i.title}`,
                description: i.description,
                priority: i.priority,
                url: i.url,
                labels: [
                  ...(i.assignee ? [`@${i.assignee}`] : ['unassigned']),
                  ...(i.age ? [i.age] : []),
                  ...(i.labels ?? []),
                ],
                actions: buildTriageActions(i, { transition: transitionTool, close: closeTool, assign: assignTool }, baseArgs),
              })),
            },
          ],
        },
        ...(caption ? [{ type: 'markdown' as const, id: 'caption', content: caption }] : []),
      ],
    };
  },
};
