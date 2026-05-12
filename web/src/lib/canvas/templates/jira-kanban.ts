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
   * Full MCP tool name to call when transitioning issues. Differs by org —
   * may be `mcp__claude_ai_Atlassian__transitionJiraIssue`,
   * `mcp__nib-mcp-atlassian__transitionJiraIssue`, etc. The agent fills this
   * in based on which Atlassian MCP it has available.
   */
  transitionTool: string;
  /**
   * Base args passed alongside per-issue transition args (e.g. `cloudId`).
   * Merged into each card's tool-call args.
   */
  baseToolArgs?: Record<string, unknown>;
  /** Column order: e.g. ["To Do", "In Progress", "In Review", "Done"]. */
  columns: string[];
  issues: JiraIssue[];
  /** Optional caption / context note rendered below the board. */
  caption?: string;
  /**
   * Optional natural-language prompt that the canvas can use to re-fetch
   * itself after a writeback (status transition, comment, etc.). The agent
   * should set this to something like:
   *   "Re-fetch <JQL> from Jira and render the kanban again."
   * If omitted, the canvas stays stale after actions.
   */
  refreshPrompt?: string;
}

function buildTransitionActions(
  issue: JiraIssue,
  transitionTool: string,
  baseToolArgs: Record<string, unknown>,
): KanbanCardAction[] {
  if (!issue.transitions || issue.transitions.length === 0) return [];
  return issue.transitions.map((t) => ({
    actionId: `transition-${issue.key}-${t.id}`,
    label: `→ ${t.name}`,
    variant: 'secondary' as const,
    tool: transitionTool,
    args: {
      ...baseToolArgs,
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
  whenToUse:
    'When the user asks for their Jira backlog, sprint board, in-progress tickets, or any Jira issue list. ' +
    'First, identify which Atlassian MCP is available — common server names are `claude_ai_Atlassian` and `nib-mcp-atlassian` (the tool prefix is `mcp__<server>__<toolName>`). ' +
    'Use the *_searchJiraIssuesUsingJql tool from that server to fetch issues, group by status, and include each issue\'s allowed transitions via *_getTransitionsForJiraIssue. ' +
    'Pass the `transitionTool` field as the FULL MCP tool name for transitions (e.g. `mcp__nib-mcp-atlassian__transitionJiraIssue`). ' +
    'If the Atlassian MCP requires a `cloudId` arg, fetch it via *_getAccessibleAtlassianResources and pass it in `baseToolArgs`. ' +
    'ALWAYS pass `refreshPrompt` so the canvas can re-fetch itself after a transition without the user having to re-ask. ' +
    'Example: `refreshPrompt: "Re-fetch open issues in PROM via the Atlassian MCP and render the jira_kanban canvas again with the same columns."`',
  inputShape:
    '{ title: string, transitionTool: string (FULL MCP tool name, e.g. "mcp__nib-mcp-atlassian__transitionJiraIssue"), baseToolArgs?: { cloudId?: string, ... } (merged into each transition call), columns: string[] (status names in order), issues: { key, title, description?, status, priority?, labels?, url?, assignee?, transitions?: [{id, name}] }[], caption?: string, refreshPrompt?: string (NL prompt to re-render the canvas after a transition) }',
  render: ({ title, transitionTool, baseToolArgs = {}, columns, issues, caption, refreshPrompt }) => {
    const safeIssues = Array.isArray(issues) ? issues : [];
    // Derive columns from issue statuses if the agent didn't supply them.
    const safeColumns = Array.isArray(columns) && columns.length > 0
      ? columns
      : Array.from(new Set(safeIssues.map((i) => i.status).filter(Boolean)));

    // No data at all — show a clear placeholder rather than a blank panel.
    if (safeColumns.length === 0 && safeIssues.length === 0) {
      return {
        version: '1',
        title: title || 'Jira backlog',
        components: [
          {
            type: 'markdown',
            id: 'empty',
            content: '_No issues to render. The agent called the kanban template but did not pass any `columns` or `issues`. This usually means an upstream Atlassian MCP call failed or hung — try the prompt again, possibly scoped to a project (e.g. "show my open Jira tickets in PROJECT-KEY")._',
          },
        ],
      };
    }

    const byStatus = new Map<string, JiraIssue[]>();
    for (const col of safeColumns) byStatus.set(col, []);
    for (const issue of safeIssues) {
      const bucket = byStatus.get(issue.status) ?? [];
      bucket.push(issue);
      byStatus.set(issue.status, bucket);
    }
    return {
      version: '1',
      title: title || 'Jira backlog',
      ...(refreshPrompt ? { refreshPrompt } : {}),
      components: [
        {
          type: 'kanban',
          id: 'board',
          title: title || 'Jira backlog',
          columns: safeColumns.map((status) => ({
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
              actions: transitionTool
                ? buildTransitionActions(issue, transitionTool, baseToolArgs)
                : [],
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
