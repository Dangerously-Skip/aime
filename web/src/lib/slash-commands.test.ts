import { describe, it, expect } from 'vitest';
import {
  parseSlashCommand,
  applySlashCommand,
  getSlashSuggestions,
  DEFAULT_SESSION_CONTROLS,
  SLASH_COMMANDS,
  type SessionControls,
} from './slash-commands';

const controls = (overrides: Partial<SessionControls> = {}): SessionControls => ({
  ...DEFAULT_SESSION_CONTROLS,
  ...overrides,
});

describe('parseSlashCommand', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello world')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('a /think high')).toBeNull();
  });

  it('parses command and args, trimming whitespace', () => {
    expect(parseSlashCommand('  /think high  ')).toEqual({
      command: '/think',
      args: ['high'],
      rawInput: '/think high',
    });
  });

  it('lowercases the command but not the args', () => {
    const cmd = parseSlashCommand('/MODEL Opus');
    expect(cmd?.command).toBe('/model');
    expect(cmd?.args).toEqual(['Opus']);
  });

  it('splits multiple args on arbitrary whitespace', () => {
    expect(parseSlashCommand('/agent   my-agent   extra')?.args).toEqual(['my-agent', 'extra']);
  });

  it('parses a bare slash as a command with no args', () => {
    expect(parseSlashCommand('/')).toEqual({ command: '/', args: [], rawInput: '/' });
  });
});

describe('applySlashCommand', () => {
  it('sets think level and reports token budget', () => {
    const result = applySlashCommand(parseSlashCommand('/think high')!, controls());
    expect(result?.controls.thinkLevel).toBe('high');
    expect(result?.message).toContain('16000 tokens');
  });

  it('defaults /think to medium when no arg given', () => {
    const result = applySlashCommand(parseSlashCommand('/think')!, controls());
    expect(result?.controls.thinkLevel).toBe('medium');
  });

  it('reports adaptive think level without a token count', () => {
    const result = applySlashCommand(parseSlashCommand('/think adaptive')!, controls());
    expect(result?.controls.thinkLevel).toBe('adaptive');
    expect(result?.message).toContain('adaptive');
  });

  it('rejects invalid think level and leaves controls unchanged', () => {
    const before = controls();
    const result = applySlashCommand(parseSlashCommand('/think ultra')!, before);
    expect(result?.controls).toEqual(before);
    expect(result?.message).toContain('Unknown think level');
  });

  it('toggles verbose mode when no arg given', () => {
    const result = applySlashCommand(parseSlashCommand('/verbose')!, controls({ verboseMode: true }));
    expect(result?.controls.verboseMode).toBe(false);
  });

  it('sets verbose explicitly with on/off', () => {
    expect(
      applySlashCommand(parseSlashCommand('/verbose off')!, controls({ verboseMode: true }))?.controls.verboseMode,
    ).toBe(false);
    expect(
      applySlashCommand(parseSlashCommand('/verbose on')!, controls({ verboseMode: false }))?.controls.verboseMode,
    ).toBe(true);
  });

  it('toggles reasoning visibility', () => {
    const result = applySlashCommand(parseSlashCommand('/reasoning')!, controls({ reasoningVisible: true }));
    expect(result?.controls.reasoningVisible).toBe(false);
  });

  it('sets effort level for valid values', () => {
    const result = applySlashCommand(parseSlashCommand('/effort max')!, controls());
    expect(result?.controls.effortLevel).toBe('max');
  });

  it('shows usage for /effort with missing or invalid arg', () => {
    const before = controls({ effortLevel: 'high' });
    const result = applySlashCommand(parseSlashCommand('/effort')!, before);
    expect(result?.controls).toEqual(before);
    expect(result?.message).toContain('Usage: /effort');
    expect(result?.message).toContain('high');

    const invalid = applySlashCommand(parseSlashCommand('/effort extreme')!, before);
    expect(invalid?.controls.effortLevel).toBe('high');
  });

  it('sets model override and reports current one when arg missing', () => {
    const result = applySlashCommand(parseSlashCommand('/model opus')!, controls());
    expect(result?.controls.modelOverride).toBe('opus');

    const query = applySlashCommand(parseSlashCommand('/model')!, controls({ modelOverride: 'sonnet' }));
    expect(query?.controls.modelOverride).toBe('sonnet');
    expect(query?.message).toContain('sonnet');
  });

  it('binds an agent and reports current binding when arg missing', () => {
    const result = applySlashCommand(parseSlashCommand('/agent researcher')!, controls());
    expect(result?.controls.agentName).toBe('researcher');

    const query = applySlashCommand(parseSlashCommand('/agent')!, controls());
    expect(query?.controls.agentName).toBeNull();
    expect(query?.message).toContain('none');
  });

  it('lists every registered command for /help', () => {
    const result = applySlashCommand(parseSlashCommand('/help')!, controls());
    for (const c of SLASH_COMMANDS) {
      expect(result?.message).toContain(c.name);
    }
  });

  it('returns null for unrecognized commands', () => {
    expect(applySlashCommand(parseSlashCommand('/frobnicate')!, controls())).toBeNull();
  });
});

describe('getSlashSuggestions', () => {
  it('returns nothing for non-slash input', () => {
    expect(getSlashSuggestions('think')).toEqual([]);
  });

  it('returns all commands for a bare slash', () => {
    expect(getSlashSuggestions('/')).toHaveLength(SLASH_COMMANDS.length);
  });

  it('filters by prefix, case-insensitively', () => {
    expect(getSlashSuggestions('/th').map((c) => c.name)).toEqual(['/think']);
    expect(getSlashSuggestions('/TH').map((c) => c.name)).toEqual(['/think']);
  });

  it('returns nothing for a prefix that matches no command', () => {
    expect(getSlashSuggestions('/xyz')).toEqual([]);
  });
});
