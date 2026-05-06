import type { CanvasTemplate } from './types';

interface ActionItem {
  /** Short description of the action. */
  text: string;
  /** Owner — display name or @handle. */
  owner?: string;
  /** Optional due date (ISO or human). */
  due?: string;
  /** Priority. */
  priority?: 'low' | 'medium' | 'high';
  /** Suggested Jira project key (e.g. "TIP", "AP"). */
  jiraProject?: string;
  /** Suggested Jira issue type (e.g. "Task", "Story"). */
  jiraType?: string;
}

interface MeetingActionsInput {
  /** Meeting title or summary. */
  title: string;
  /** Optional meeting date / time. */
  date?: string;
  /** Optional attendee list. */
  attendees?: string[];
  /** Brief meeting summary (markdown OK). */
  summary?: string;
  /** Extracted action items. */
  actions: ActionItem[];
  /** Atlassian cloudId. */
  cloudId?: string;
  /** Full MCP tool name for createJiraIssue. */
  createIssueTool?: string;
}

export const meetingActionsTemplate: CanvasTemplate<MeetingActionsInput> = {
  id: 'meeting_actions',
  name: 'Meeting → action items',
  description: 'Convert a meeting transcript or notes into a structured list of action items, each with a one-click "Create Jira ticket" button.',
  whenToUse:
    'When the user pastes meeting notes, a transcript, or asks to extract follow-ups from a meeting. ' +
    'Identify action items (anything starting with a verb assigned to a person). ' +
    'For each: extract owner, due date if mentioned, suggest a priority and Jira project. ' +
    'Pass `createIssueTool` (full MCP name) + `cloudId` so the per-item ticket-creation actions wire up.',
  inputShape:
    '{ title: string, date?: string, attendees?: string[], summary?: string (markdown), actions: { text, owner?, due?, priority?, jiraProject?, jiraType? }[], cloudId?: string, createIssueTool?: string }',
  render: ({ title, date, attendees, summary, actions, cloudId, createIssueTool }) => {
    const safeActions = Array.isArray(actions) ? actions : [];

    const components: import('@/lib/a2ui/types').A2UIComponent[] = [
      {
        type: 'stat',
        id: 'overview',
        stats: [
          ...(date ? [{ label: 'Date', value: date }] : []),
          { label: 'Action items', value: safeActions.length },
          ...(attendees && attendees.length > 0 ? [{ label: 'Attendees', value: String(attendees.length) }] : []),
        ],
      },
      ...(summary ? [{ type: 'markdown' as const, id: 'summary', title: 'Summary', content: summary }] : []),
      ...(attendees && attendees.length > 0
        ? [{
            type: 'list' as const,
            id: 'attendees',
            title: 'Attendees',
            items: attendees.map((a, i) => ({ id: `att-${i}`, text: a, icon: '👤' })),
          }]
        : []),
    ];

    // One action-card per action item with a Create-Jira button.
    safeActions.forEach((item, idx) => {
      const ownerHint = item.owner ? ` for @${item.owner}` : '';
      const dueHint = item.due ? `, due ${item.due}` : '';
      const priorityHint = item.priority ? ` priority: ${item.priority}` : '';
      const projectHint = item.jiraProject ? ` Project: ${item.jiraProject}.` : ' Ask the user which Jira project to file under.';
      const typeHint = item.jiraType ? ` Type: ${item.jiraType}.` : '';

      const args: Record<string, unknown> = {
        ...(cloudId ? { cloudId } : {}),
        summary: item.text,
        ...(item.owner ? { assignee: item.owner } : {}),
      };
      if (item.jiraProject) args.projectKey = item.jiraProject;
      if (item.jiraType) args.issueType = item.jiraType;

      components.push({
        type: 'action-card',
        id: `action-${idx}`,
        title: item.text,
        subtitle: [item.owner ? `@${item.owner}` : null, item.due, item.priority]
          .filter(Boolean).join(' · ') || undefined,
        actions: createIssueTool
          ? [{
              actionId: `create-jira-${idx}`,
              label: '➕ Create Jira ticket',
              variant: 'primary',
              tool: createIssueTool,
              args,
              feedbackPrompt:
                `Create a Jira ticket${ownerHint}${dueHint}${priorityHint}: "${item.text}".` +
                projectHint + typeHint +
                ' If essential info is missing, ask the user before submitting.',
            }]
          : [{
              actionId: `discuss-${idx}`,
              label: '💬 Discuss with agent',
              variant: 'secondary',
              feedbackPrompt: `Help the user turn this action item into a Jira ticket: "${item.text}"${ownerHint}${dueHint}.`,
            }],
      });
    });

    return {
      version: '1',
      title: title || 'Meeting actions',
      components,
    };
  },
};
