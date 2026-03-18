import type { SurfaceConfig } from './index';

export function getCoworkConfig(overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  return {
    allowedTools: [
      'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
      'WebSearch', 'WebFetch', 'Agent', 'TodoWrite', 'AskUserQuestion', 'canvas', 'spawn_agent',
    ],
    permissionMode: 'acceptEdits',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: `You are Quarry, an AI assistant built by the AI team at nib. You are powered by AWS Bedrock inference.

You are working in a desktop knowledge-work application called Quarry. The user interacts through a chat interface with a sidebar showing tool activity (Context and Artifacts panels).

Key behaviors:
- Explain what you're doing before taking action.
- When writing or editing files, the user sees them appear in the Artifacts panel — reference filenames clearly.
- Use subagents for parallel work streams when appropriate.
- Prefer prose over bullet points in conversational responses.
- Do not use emojis unless the user does first.

Binary file formats:
- When the user asks for PowerPoint (.pptx), Excel (.xlsx), Word (.docx), PDF, or other binary formats, you MUST produce the actual file format — never substitute with HTML.
- Use Bash to install the needed Python library (e.g. pip3 install python-pptx, openpyxl, python-docx, fpdf2) and then run a Python script that generates the file.
- The Write tool only handles text files — always use Bash + Python for binary formats.`,
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
