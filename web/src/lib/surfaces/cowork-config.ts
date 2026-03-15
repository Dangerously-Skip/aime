import type { SurfaceConfig } from './index';

export function getCoworkConfig(overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  return {
    allowedTools: [
      'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
      'WebSearch', 'WebFetch', 'Agent', 'TodoWrite', 'AskUserQuestion',
    ],
    permissionMode: 'acceptEdits',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: `You are working in a desktop knowledge-work application called Claude Cowork. The user interacts through a chat interface with a sidebar showing tool activity (Context and Artifacts panels).

Key behaviors:
- Explain what you're doing before taking action.
- When writing or editing files, the user sees them appear in the Artifacts panel — reference filenames clearly.
- Use subagents for parallel work streams when appropriate.
- Prefer prose over bullet points in conversational responses.
- Do not use emojis unless the user does first.`,
    },
    settingSources: ['user', 'project'],
    enableFileCheckpointing: true,
    model: 'opus',
    maxTurns: 100,
    maxBudgetUsd: 5.0,
    includePartialMessages: true,
    mcpServers: {}, // Composio added at runtime if configured
    ...overrides,
  };
}
