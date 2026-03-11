export function getChatConfig(overrides = {}) {
  return {
    allowedTools: ['WebSearch', 'WebFetch'],
    permissionMode: 'default',
    systemPrompt: `You are a helpful, thoughtful AI assistant. Provide clear, well-structured responses. Use markdown formatting for readability. When asked about code, provide examples. When asked about facts, be precise and cite sources when possible.`,
    model: 'sonnet',
    maxTurns: 20,
    maxBudgetUsd: 1.0,
    includePartialMessages: true,
    mcpServers: {},
    ...overrides,
  };
}
