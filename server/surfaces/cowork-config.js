export function getCoworkConfig(overrides = {}) {
  return {
    allowedTools: [
      'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
      'WebSearch', 'WebFetch', 'Agent', 'TodoWrite', 'AskUserQuestion',
    ],
    permissionMode: 'acceptEdits',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: `You are working in a desktop knowledge-work environment. Focus on completing tasks efficiently. Show file diffs clearly. Use subagents for parallel work streams when appropriate. Always explain what you're doing before taking action.`,
    },
    settingSources: ['user', 'project'],
    enableFileCheckpointing: true,
    model: 'opus',
    maxTurns: 100,
    maxBudgetUsd: 5.0,
    includePartialMessages: true,
    mcpServers: {},  // Composio added at runtime if configured
    ...overrides,
  };
}
