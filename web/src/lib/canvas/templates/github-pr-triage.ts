import type { CanvasTemplate } from './types';
import type { KanbanCardAction } from '@/lib/a2ui/types';
import { APP_NAME } from '@/config/branding';

interface PullRequest {
  /** Repo owner. */
  owner: string;
  /** Repo name. */
  repo: string;
  /** PR number. */
  number: number;
  title: string;
  /** Issue/PR description (truncated). */
  description?: string;
  /** Author login. */
  author?: string;
  /** Comma-separated reviewer logins requested. */
  reviewers?: string[];
  /** PR state bucket: 'needs_review' | 'approved' | 'changes_requested' | 'draft' | 'merged'. */
  state: string;
  /** Mergeable status hint. */
  mergeable?: 'mergeable' | 'conflicting' | 'unknown';
  /** Web URL — `https://github.com/<owner>/<repo>/pull/<number>`. */
  url: string;
  /** Labels. */
  labels?: string[];
  /** Optional age in human form (e.g. "3d"). */
  age?: string;
  /** Mark high-priority for kanban card visual emphasis. */
  priority?: 'low' | 'medium' | 'high';
}

interface PRTriageInput {
  title: string;
  /**
   * MCP tool prefix for GitHub. The agent fills this in based on which
   * GitHub MCP is connected — e.g. `mcp__github__` or `mcp__aime-connector-github__`.
   * Leave trailing double-underscore.
   */
  toolPrefix: string;
  /** Column order. Default: ["Needs review", "Changes requested", "Approved", "Draft"]. */
  columns?: string[];
  prs: PullRequest[];
  /** Optional caption rendered below the board. */
  caption?: string;
}

const DEFAULT_COLUMNS = ['Needs review', 'Changes requested', 'Approved', 'Draft'];

const STATE_TO_COLUMN: Record<string, string> = {
  needs_review: 'Needs review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  draft: 'Draft',
  merged: 'Approved',
};

function buildActions(pr: PullRequest, toolPrefix: string): KanbanCardAction[] {
  const baseArgs = { owner: pr.owner, repo: pr.repo, pullNumber: pr.number };
  const actions: KanbanCardAction[] = [];

  if (pr.state !== 'approved' && pr.state !== 'merged') {
    actions.push({
      actionId: `approve-${pr.number}`,
      label: '✓ Approve',
      variant: 'primary',
      tool: `${toolPrefix}create_and_submit_pull_request_review`,
      args: { ...baseArgs, event: 'APPROVE', body: `Approved via ${APP_NAME} canvas.` },
      feedbackPrompt: `Approve PR #${pr.number} in ${pr.owner}/${pr.repo}.`,
    });
  }
  if (pr.state !== 'changes_requested' && pr.state !== 'merged') {
    actions.push({
      actionId: `request-changes-${pr.number}`,
      label: '✗ Request changes',
      variant: 'destructive',
      tool: `${toolPrefix}create_and_submit_pull_request_review`,
      args: { ...baseArgs, event: 'REQUEST_CHANGES', body: `Changes requested via ${APP_NAME} canvas.` },
      feedbackPrompt: `Request changes on PR #${pr.number} in ${pr.owner}/${pr.repo}. Ask the user what changes to request before submitting.`,
    });
  }
  actions.push({
    actionId: `comment-${pr.number}`,
    label: '💬 Comment',
    variant: 'secondary',
    feedbackPrompt: `Help the user write a review comment on PR #${pr.number} in ${pr.owner}/${pr.repo}, then submit it via the GitHub MCP.`,
  });
  if (pr.state === 'approved' && pr.mergeable !== 'conflicting') {
    actions.push({
      actionId: `merge-${pr.number}`,
      label: '🔀 Merge',
      variant: 'primary',
      tool: `${toolPrefix}merge_pull_request`,
      args: { ...baseArgs, mergeMethod: 'squash' },
      feedbackPrompt: `Squash-merge PR #${pr.number} in ${pr.owner}/${pr.repo}.`,
    });
  }
  return actions;
}

export const githubPrTriageTemplate: CanvasTemplate<PRTriageInput> = {
  id: 'github_pr_triage',
  name: 'GitHub PR triage',
  description: 'Render open pull requests as a kanban board grouped by review state, with one-click actions for approve, request changes, comment, and merge.',
  whenToUse:
    'When the user asks for their open PRs, PRs to review, or wants to triage pull requests. ' +
    'First, identify which GitHub MCP is connected — common server names are `github` and `aime-connector-github` (or legacy `nib-connector-github`) (tool format `mcp__<server>__<tool>`). ' +
    'Use the *_search_pull_requests or *_list_pull_requests tool to fetch PRs. For each, determine its review state by inspecting reviews (*_get_pull_request_reviews): ' +
    '"approved" if any APPROVED review and no later CHANGES_REQUESTED; "changes_requested" if any CHANGES_REQUESTED review; "draft" if `draft: true`; otherwise "needs_review". ' +
    'Pass `toolPrefix` as `mcp__<server>__` so the template can build action calls — e.g. `mcp__aime-connector-github__`. ' +
    'Limit to ~20 most relevant PRs to keep the board readable.',
  inputShape:
    '{ title: string, toolPrefix: string (e.g. "mcp__aime-connector-github__"), columns?: string[] (default ["Needs review", "Changes requested", "Approved", "Draft"]), prs: { owner, repo, number, title, description?, author?, reviewers?, state ("needs_review"|"changes_requested"|"approved"|"draft"|"merged"), mergeable?, url, labels?, age?, priority? }[], caption?: string }',
  render: ({ title, toolPrefix, columns, prs, caption }) => {
    const safePrs = Array.isArray(prs) ? prs : [];
    const safeColumns = (Array.isArray(columns) && columns.length > 0) ? columns : DEFAULT_COLUMNS;

    if (safePrs.length === 0) {
      return {
        version: '1',
        title: title || 'PR triage',
        components: [
          {
            type: 'markdown',
            id: 'empty',
            content: '_No pull requests to triage. The agent called the PR triage template but did not pass any PRs._',
          },
        ],
      };
    }

    const byColumn = new Map<string, PullRequest[]>();
    for (const col of safeColumns) byColumn.set(col, []);
    for (const pr of safePrs) {
      const col = STATE_TO_COLUMN[pr.state] ?? safeColumns[0];
      const bucket = byColumn.get(col) ?? [];
      bucket.push(pr);
      byColumn.set(col, bucket);
    }

    return {
      version: '1',
      title: title || 'PR triage',
      components: [
        {
          type: 'kanban',
          id: 'pr-board',
          title: title || 'PR triage',
          columns: safeColumns.map((col) => ({
            id: col,
            title: col,
            cards: (byColumn.get(col) ?? []).map((pr) => {
              const repoTag = `${pr.owner}/${pr.repo}#${pr.number}`;
              return {
                id: `${pr.owner}-${pr.repo}-${pr.number}`,
                title: `${repoTag}: ${pr.title}`,
                description: pr.description,
                labels: [
                  ...(pr.author ? [`@${pr.author}`] : []),
                  ...(pr.age ? [pr.age] : []),
                  ...(pr.mergeable === 'conflicting' ? ['⚠️ conflicts'] : []),
                  ...(pr.labels ?? []),
                ],
                priority: pr.priority,
                url: pr.url,
                actions: toolPrefix ? buildActions(pr, toolPrefix) : [],
              };
            }),
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
