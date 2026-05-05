import type { CanvasTemplate } from './types';
import type { KanbanCardAction } from '@/lib/a2ui/types';

interface JiraIssue {
  key: string;
  /** Issue summary. */
  title: string;
  description?: string;
  status: string;
  priority?: 'low' | 'medium' | 'high';
  labels?: string[];
  url?: string;
  assignee?: string;
  /** Allowed transitions for this issue, e.g. [{ id: '21', name: 'In Progress' }]. */
  transitions?: Array<{ id: string; name: string }>;
}

interface JiraKanbanInput {
  title: string;
  /**
   * Atlassian site cloudId — required by `mcp__claude_ai_Atlassian__transitionJiraIssue`.
   * The agent gets this from `getAccessibleAtlassianResources`.
   */
  cloudId: string;
  /** Column order: e.g. ["To Do", "In Progress", "In Review", "Done"]. */
  columns: string[];
  issues: JiraIssue[];
  /** Optional caption / context note rendered below the board. */
  caption?: string;
}

function buildTransitionActions(issue: JiraIssue, cloudId: string): KanbanCardAction[] {
  if (!issue.transitions || issue.transitions.length === 0) return [];
  return issue.transitions.map((t) => ({
    actionId: `transition-${issue.key}-${t.id}`,
    label: `→ ${t.name}`,
    variant: 'secondary' as const,
    tool: 'mcp__claude_ai_Atlassian__transitionJiraIssue',
    args: {
      cloudId,
      issueIdOrKey: issue.key,
      transition: { id: t.id },
    },
    feedbackPrompt: `Move Jira issue ${issue.key} to "${t.name}".`,
  }));
}

export const jiraKanbanTemplate: CanvasTemplate<JiraKanbanInput> = {
  id: 'jira_kanban',
  name: 'Jira backlog kanban',
  description: 'Render a kanban board of Jira issues grouped by status, with one-click transition buttons on each card. Cards link out to the Jira issue.',
  whenToUse: 'When the user asks for their Jira backlog, sprint board, in-progress tickets, or any Jira issue list. Always fetch issues via `mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql` first, then group by status. Get `cloudId` from `getAccessibleAtlassianResources`. For each issue, include its allowed transitions from `getTransitionsForJiraIssue` so users can move tickets without leaving Quarry.',
  inputShape: '{ title: string, cloudId: string, columns: string[] (status names in order), issues: { key, title, description?, status, priority?, labels?, url?, assignee?, transitions?: [{id, name}] }[], caption?: string }',
  render: ({ title, cloudId, columns, issues, caption }) => {
    const byStatus = new Map<string, JiraIssue[]>();
    for (const col of columns) byStatus.set(col, []);
    for (const issue of issues) {
      const bucket = byStatus.get(issue.status) ?? [];
      bucket.push(issue);
      byStatus.set(issue.status, bucket);
    }
    return {
      version: '1',
      title,
      components: [
        {
          type: 'kanban',
          id: 'board',
          title,
          columns: columns.map((status) => ({
            id: status,
            title: status,
            cards: (byStatus.get(status) ?? []).map((issue) => ({
              id: issue.key,
              title: `${issue.key}: ${issue.title}`,
              description: issue.description,
              labels: [
                ...(issue.assignee ? [`@${issue.assignee}`] : []),
                ...(issue.labels ?? []),
              ],
              priority: issue.priority,
              url: issue.url,
              actions: buildTransitionActions(issue, cloudId),
            })),
          })),
        },
        ...(caption
          ? [
              {
                type: 'markdown' as const,
                id: 'caption',
                content: caption,
              },
            ]
          : []),
      ],
    };
  },
};
