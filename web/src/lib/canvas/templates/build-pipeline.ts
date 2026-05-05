import type { CanvasTemplate } from './types';

interface Build {
  number: number;
  pipeline: string;
  branch?: string;
  commit?: string;
  state: 'passed' | 'failed' | 'running' | 'canceled' | 'scheduled' | 'blocked' | 'skipped';
  /** Human-readable trigger ("on push", "scheduled", etc.). */
  trigger?: string;
  /** Author/committer login. */
  author?: string;
  /** Duration in seconds. */
  durationSec?: number;
  /** Web URL — `https://buildkite.com/<org>/<pipeline>/builds/<n>`. */
  url: string;
  /** ISO timestamp. */
  createdAt?: string;
}

interface BuildPipelineInput {
  title: string;
  org?: string;
  pipeline?: string;
  builds: Build[];
  /** Optional caption. */
  caption?: string;
}

const STATE_EMOJI: Record<string, string> = {
  passed: '✅',
  failed: '❌',
  running: '🔄',
  canceled: '⚪',
  scheduled: '🕐',
  blocked: '⛔',
  skipped: '⏭️',
};

function formatDuration(sec?: number): string {
  if (typeof sec !== 'number') return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export const buildPipelineTemplate: CanvasTemplate<BuildPipelineInput> = {
  id: 'build_pipeline',
  name: 'Build pipeline status',
  description: 'Render recent CI builds (Buildkite, GitHub Actions, etc.) as a status board with state badges, durations, and clickable build links.',
  whenToUse:
    'When the user asks for build status, recent CI runs, deploy history, or pipeline health. ' +
    'Use the Buildkite MCP `*_list_builds` or GitHub Actions MCP `*_list_workflow_runs` to fetch the last 10–20 builds, then call this template.',
  inputShape:
    '{ title: string, org?: string, pipeline?: string, builds: { number, pipeline, branch?, commit?, state ("passed"|"failed"|"running"|"canceled"|"scheduled"|"blocked"|"skipped"), trigger?, author?, durationSec?, url, createdAt? }[], caption?: string }',
  render: ({ title, org, pipeline, builds, caption }) => {
    const safeBuilds = Array.isArray(builds) ? builds : [];
    const passed = safeBuilds.filter((b) => b.state === 'passed').length;
    const failed = safeBuilds.filter((b) => b.state === 'failed').length;
    const running = safeBuilds.filter((b) => b.state === 'running').length;

    return {
      version: '1',
      title: title || (pipeline ? `${org ? org + '/' : ''}${pipeline}` : 'Build pipeline'),
      components: [
        {
          type: 'stat',
          id: 'overview',
          stats: [
            { label: 'Total', value: safeBuilds.length },
            { label: 'Passed', value: passed, trend: 'up' as const, trendValue: `${Math.round((passed / Math.max(1, safeBuilds.length)) * 100)}%` },
            { label: 'Failed', value: failed, trend: failed > 0 ? ('down' as const) : ('neutral' as const) },
            { label: 'Running', value: running },
          ],
        },
        {
          type: 'table',
          id: 'builds',
          title: 'Recent builds',
          columns: [
            { key: 'state', label: 'Status', type: 'badge' as const },
            { key: 'number', label: '#' },
            { key: 'pipeline', label: 'Pipeline' },
            { key: 'branch', label: 'Branch' },
            { key: 'author', label: 'Who' },
            { key: 'duration', label: 'Duration' },
            { key: 'when', label: 'When' },
          ],
          rows: safeBuilds.map((b) => ({
            state: `${STATE_EMOJI[b.state] ?? ''} ${b.state}`,
            number: b.number,
            pipeline: b.pipeline,
            branch: b.branch ?? '',
            author: b.author ?? '',
            duration: formatDuration(b.durationSec),
            when: relativeTime(b.createdAt),
          })),
        },
        ...(caption ? [{ type: 'markdown' as const, id: 'caption', content: caption }] : []),
      ],
    };
  },
};
