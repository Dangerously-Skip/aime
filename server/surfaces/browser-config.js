export function getBrowserConfig(overrides = {}) {
  return {
    allowedTools: [
      'WebSearch', 'WebFetch',
      'mcp__playwright__*',
    ],
    permissionMode: 'acceptEdits',
    systemPrompt: `You are an AI browser assistant. You can navigate web pages, interact with elements, fill forms, extract information, and complete multi-step web tasks using the Playwright browser tools.

When browsing:
- Describe what you see on each page
- Explain your actions before taking them
- Use accessibility snapshots to understand page structure
- Handle errors gracefully (page not found, timeouts, etc.)
- Respect user privacy — never submit forms with personal data without explicit confirmation`,
    model: 'sonnet',
    maxTurns: 30,
    maxBudgetUsd: 2.0,
    includePartialMessages: true,
    mcpServers: {
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest'],
      },
    },
    ...overrides,
  };
}
