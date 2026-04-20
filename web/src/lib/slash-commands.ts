/**
 * Slash command parser for interactive session controls.
 * Parses /cmd args from user input before submission.
 */

export type ThinkLevel = 'off' | 'low' | 'medium' | 'high' | 'adaptive';
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export interface SlashCommand {
  command: string;
  args: string[];
  rawInput: string;
}

export interface SessionControls {
  thinkLevel: ThinkLevel;
  effortLevel: EffortLevel | null;
  verboseMode: boolean;
  reasoningVisible: boolean;
  modelOverride: string | null;
  agentName: string | null;
}

export const DEFAULT_SESSION_CONTROLS: SessionControls = {
  thinkLevel: 'off',
  effortLevel: null,
  verboseMode: true,
  reasoningVisible: true,
  modelOverride: null,
  agentName: null,
};

/** Map think level names to budget_tokens values. */
export const THINK_LEVEL_TOKENS: Record<ThinkLevel, number> = {
  off: 0,
  low: 1024,
  medium: 4096,
  high: 16000,
  adaptive: -1,
};

/** All recognized slash commands. */
export const SLASH_COMMANDS = [
  { name: '/think', description: 'Set thinking depth: off, low, medium, high, adaptive', args: '<level>' },
  { name: '/verbose', description: 'Toggle verbose tool output on/off', args: '[on|off]' },
  { name: '/reasoning', description: 'Toggle reasoning/thinking block visibility', args: '[on|off]' },
  { name: '/model', description: 'Override model for this session', args: '<name>' },
  { name: '/effort', description: 'Set reasoning effort: low, medium, high, max', args: '<level>' },
  { name: '/agent', description: 'Bind session to a named agent from AGENTS.md', args: '<name>' },
  { name: '/help', description: 'Show available slash commands', args: '' },
];

/**
 * Parse a user input string.
 * Returns a SlashCommand if input starts with '/', otherwise null.
 */
export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  // Split on whitespace — first token is the command
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  return { command, args, rawInput: trimmed };
}

/**
 * Apply a slash command to session controls.
 * Returns updated session controls or null if command is not recognized as a control command.
 */
export function applySlashCommand(
  cmd: SlashCommand,
  controls: SessionControls,
): { controls: SessionControls; message: string } | null {
  switch (cmd.command) {
    case '/think': {
      const level = (cmd.args[0] || 'medium').toLowerCase() as ThinkLevel;
      const valid: ThinkLevel[] = ['off', 'low', 'medium', 'high', 'adaptive'];
      if (!valid.includes(level)) {
        return {
          controls,
          message: `Unknown think level "${level}". Valid: ${valid.join(', ')}`,
        };
      }
      return {
        controls: { ...controls, thinkLevel: level },
        message: `Thinking set to **${level}**${level === 'off' ? '' : ` (${THINK_LEVEL_TOKENS[level] === -1 ? 'adaptive' : THINK_LEVEL_TOKENS[level] + ' tokens'})`}`,
      };
    }

    case '/verbose': {
      const toggle = cmd.args[0]?.toLowerCase();
      const verboseMode = toggle === 'off' ? false : toggle === 'on' ? true : !controls.verboseMode;
      return {
        controls: { ...controls, verboseMode },
        message: `Verbose mode **${verboseMode ? 'on' : 'off'}**`,
      };
    }

    case '/reasoning': {
      const toggle = cmd.args[0]?.toLowerCase();
      const reasoningVisible = toggle === 'off' ? false : toggle === 'on' ? true : !controls.reasoningVisible;
      return {
        controls: { ...controls, reasoningVisible },
        message: `Reasoning display **${reasoningVisible ? 'on' : 'off'}**`,
      };
    }

    case '/effort': {
      const level = (cmd.args[0] || '').toLowerCase() as EffortLevel;
      const validEffort: EffortLevel[] = ['low', 'medium', 'high', 'max'];
      if (!level || !validEffort.includes(level)) {
        return {
          controls,
          message: `Usage: /effort <level>. Valid: ${validEffort.join(', ')}. Current: **${controls.effortLevel ?? 'default'}**`,
        };
      }
      return {
        controls: { ...controls, effortLevel: level },
        message: `Reasoning effort set to **${level}**`,
      };
    }

    case '/model': {
      const modelName = cmd.args[0] || null;
      if (!modelName) {
        const current = controls.modelOverride ?? '(surface default)';
        return {
          controls,
          message: `Current model override: **${current}**. Usage: /model <name>`,
        };
      }
      return {
        controls: { ...controls, modelOverride: modelName },
        message: `Model overridden to **${modelName}** for this session`,
      };
    }

    case '/agent': {
      const agentName = cmd.args[0] || null;
      if (!agentName) {
        return {
          controls,
          message: `Current agent: **${controls.agentName ?? 'none (surface default)'}**. Usage: /agent <name>`,
        };
      }
      return {
        controls: { ...controls, agentName },
        message: `Agent bound to **${agentName}** for this session`,
      };
    }

    case '/help': {
      const lines = SLASH_COMMANDS.map(
        (c) => `- \`${c.name}${c.args ? ' ' + c.args : ''}\` — ${c.description}`
      );
      return {
        controls,
        message: `**Slash commands:**\n${lines.join('\n')}`,
      };
    }

    default:
      return null;
  }
}

/**
 * Check if input starts with '/' and return prefix matches for autocomplete.
 */
export function getSlashSuggestions(input: string): typeof SLASH_COMMANDS {
  if (!input.startsWith('/')) return [];
  const prefix = input.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix));
}
