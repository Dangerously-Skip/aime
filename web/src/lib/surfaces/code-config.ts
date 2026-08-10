import type { SurfaceConfig } from './index';
import { APP_NAME } from '@/config/branding';
import { webSearchPrompt } from './shared/web-search-prompt';
import { TURN_BACKSTOP } from './shared/limits';

export function getCodeConfig(overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  return {
    allowedTools: [
      'mcp__aime__FetchUrl', 'mcp__aime__CreateImage',
      'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
      'WebFetch', 'Agent', 'NotebookEdit',
      // Craft lives in skills (`craft-web`, `craft-deck`, `craft-doc`), installed
      // globally to ~/.claude/plugins/aime-skills. They were reachable from chat
      // and cowork and NOT from here — which is backwards, since this is the
      // surface that actually builds UI. Under `acceptEdits` a tool absent from
      // this list is not auto-approved, so the skill silently never loaded.
      'Skill',
      'TodoWrite', 'AskUserQuestion', 'EnterWorktree',
      'ExcelRead', 'ExcelWrite', 'ExcelEdit',
      'mcp__aime__SearchWeb', 'mcp__web-search__web_search',
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
    maxTurns: TURN_BACKSTOP.interactive,
    maxBudgetUsd: 10.0,
    queryTimeoutSecs: 600,
    includePartialMessages: true,
    mcpServers: {},
    ...overrides,
  };
}
