import type { SurfaceConfig } from './index';

export function getCodeConfig(overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  return {
    allowedTools: [
      'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
      'WebFetch', 'Agent', 'NotebookEdit',
      'TodoWrite', 'AskUserQuestion', 'EnterWorktree',
      'ExcelRead', 'ExcelWrite', 'ExcelEdit',
    ],
    permissionMode: 'acceptEdits',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: `You are Quarry, an AI assistant built by the AI team at nib. You are powered by AWS Bedrock inference.
Do not use emojis in your responses. Keep output clean, professional, and text-only.
Prefer prose over bullet points in conversational responses.

## Web search
You have web search available via the nib-web-search MCP server. When you need to search the web, use the searxng_search tool provided by that MCP server. Do NOT attempt to use a built-in WebSearch tool — it is not available in this environment.`,
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
