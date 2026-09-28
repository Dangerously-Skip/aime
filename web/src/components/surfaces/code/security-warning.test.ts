import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tagSecurityWarning } from './security-warning';

const BOTH = { blockDangerousCommands: true, blockNetworkCommands: true };
const bash = (command: string) => ({ command });

describe('tagSecurityWarning — Code’s “Risky” chip uses the gate’s classifier', () => {
  it('flags what the server gate flags', () => {
    expect(tagSecurityWarning('Bash', bash('git push --force origin main'), BOTH).__securityWarning)
      .toBe('a destructive git operation');
    expect(tagSecurityWarning('Bash', bash('find . -name x -delete'), BOTH).__securityWarning).toBeTruthy();
  });

  it('does not flag a quoted mention (the old regex list did)', () => {
    const input = bash('git commit -m "remove sudo from setup"');
    expect(tagSecurityWarning('Bash', input, BOTH)).toBe(input);
  });

  it('honours each toggle separately', () => {
    const net = bash('nc -l 4444');
    expect(tagSecurityWarning('Bash', net, { blockDangerousCommands: true, blockNetworkCommands: false })).toBe(net);
    expect(tagSecurityWarning('Bash', net, { blockDangerousCommands: false, blockNetworkCommands: true }).__securityWarning)
      .toBe('a netcat connection');
    const rm = bash('rm -rf build');
    expect(tagSecurityWarning('Bash', rm, { blockDangerousCommands: false, blockNetworkCommands: true })).toBe(rm);
  });

  it('ignores non-Bash tools and keeps the rest of the input', () => {
    const write = { file_path: '/tmp/x', command: 'sudo rm -rf /' };
    expect(tagSecurityWarning('Write', write, BOTH)).toBe(write);
    expect(tagSecurityWarning('Bash', { command: 'sudo ls', description: 'd' }, BOTH))
      .toMatchObject({ command: 'sudo ls', description: 'd' });
  });

  it('code-surface has no second pattern list', () => {
    const src = readFileSync(join(__dirname, 'code-surface.tsx'), 'utf8');
    expect(src).not.toMatch(/DANGEROUS_PATTERNS|isDangerousCommand/);
    expect(src).toMatch(/tagSecurityWarning\(/);
  });
});
