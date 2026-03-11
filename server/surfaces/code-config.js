export function getCodeConfig(overrides = {}) {
  return {
    allowedTools: [
      'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
      'WebSearch', 'WebFetch', 'Agent', 'NotebookEdit',
      'TodoWrite', 'AskUserQuestion', 'EnterWorktree',
    ],
    permissionMode: 'acceptEdits',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
    },
    settingSources: ['user', 'project', 'local'],
    enableFileCheckpointing: true,
    model: 'sonnet',
    maxTurns: 200,
    maxBudgetUsd: 10.0,
    includePartialMessages: true,
    mcpServers: {},
    ...overrides,
  };
}
