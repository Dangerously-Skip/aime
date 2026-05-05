import type { CanvasTemplate } from './types';

interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  /** 'added' | 'modified' | 'removed' | 'renamed'. */
  status?: string;
}

interface CodeReviewInput {
  title: string;
  /** Repo + PR number for header context. */
  repo?: string;
  prNumber?: number;
  prUrl?: string;
  author?: string;
  /** Total counts. */
  totalAdditions?: number;
  totalDeletions?: number;
  /** Changed files. */
  files: ChangedFile[];
  /** Markdown summary of the diff (model-generated). */
  summary?: string;
  /** Suggested review questions/concerns the agent flagged. */
  concerns?: string[];
}

export const codeReviewTemplate: CanvasTemplate<CodeReviewInput> = {
  id: 'code_review',
  name: 'Code review summary',
  description: 'Render a PR review summary — diff stats, file-by-file change list, model summary of what changed, and a list of flagged concerns.',
  whenToUse:
    'When the user asks to review a PR, summarise diffs, audit changes, or get a high-level overview of what a pull request does. ' +
    'Fetch files via the GitHub MCP `*_get_pull_request_files`. Add concerns as a separate list — things a reviewer should look at carefully ' +
    '(missing tests, unguarded null derefs, behavioural changes, security implications).',
  inputShape:
    '{ title: string, repo?: string, prNumber?: number, prUrl?: string, author?: string, totalAdditions?: number, totalDeletions?: number, files: { path, additions, deletions, status? }[], summary?: string (markdown), concerns?: string[] }',
  render: ({ title, repo, prNumber, prUrl, author, totalAdditions, totalDeletions, files, summary, concerns }) => {
    const safeFiles = Array.isArray(files) ? files : [];
    const adds = totalAdditions ?? safeFiles.reduce((s, f) => s + (f.additions ?? 0), 0);
    const dels = totalDeletions ?? safeFiles.reduce((s, f) => s + (f.deletions ?? 0), 0);

    return {
      version: '1',
      title: title || (repo && prNumber ? `${repo}#${prNumber}` : 'Code review'),
      components: [
        {
          type: 'stat',
          id: 'diff-stats',
          stats: [
            ...(prUrl ? [{ label: 'PR', value: `${repo}#${prNumber}` }] : []),
            ...(author ? [{ label: 'Author', value: `@${author}` }] : []),
            { label: 'Files', value: safeFiles.length },
            { label: '+/-', value: `+${adds} / -${dels}` },
          ],
        },
        ...(summary
          ? [{ type: 'markdown' as const, id: 'summary', title: 'Summary', content: summary }]
          : []),
        {
          type: 'table',
          id: 'files',
          title: 'Files changed',
          columns: [
            { key: 'status', label: 'Status', type: 'badge' as const },
            { key: 'path', label: 'Path' },
            { key: 'additions', label: '+', type: 'number' as const },
            { key: 'deletions', label: '-', type: 'number' as const },
          ],
          rows: safeFiles.map((f) => ({
            status: f.status ?? 'modified',
            path: f.path,
            additions: f.additions ?? 0,
            deletions: f.deletions ?? 0,
          })),
        },
        ...(concerns && concerns.length > 0
          ? [
              {
                type: 'list' as const,
                id: 'concerns',
                title: 'Reviewer concerns',
                items: concerns.map((c, i) => ({
                  id: `concern-${i}`,
                  text: c,
                  icon: '⚠️',
                })),
              },
            ]
          : []),
      ],
    };
  },
};
