import type { SurfaceConfig } from './index';
import { APP_NAME } from '@/config/branding';
import { webSearchPrompt } from './shared/web-search-prompt';

export function getCodeConfig(overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  return {
    allowedTools: [
      'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
      'WebFetch', 'Agent', 'NotebookEdit',
      'TodoWrite', 'AskUserQuestion', 'EnterWorktree',
      'ExcelRead', 'ExcelWrite', 'ExcelEdit',
      'mcp__web-search__web_search',
    ],
    permissionMode: 'acceptEdits',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: `You are ${APP_NAME}, an AI assistant.
Do not use emojis in your responses. Keep output clean, professional, and text-only.
Prefer prose over bullet points in conversational responses.

${webSearchPrompt()}`,
    },
    settingSources: ['user', 'project', 'local'],
    enableFileCheckpointing: true,
    model: 'sonnet',
    maxTurns: 200,
    maxBudgetUsd: 10.0,
    queryTimeoutSecs: 600,
    includePartialMessages: true,
    mcpServers: {},
    ...overrides,
  };
}
