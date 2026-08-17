import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLANNER_DENIED } from '@/app/api/harness/init/route';

/**
 * The planner must not be able to do the work it is planning.
 *
 * Two reasons, and only the second is a security one. A planner that starts
 * building produces a plan describing whatever it happened to try first. And the
 * thing that decides what "done" means must not be the thing that later gets to
 * declare itself done — that is the whole reason the initializer is a separate
 * session from the execution ones.
 *
 * This is derived from source rather than hand-listed, so a new write tool added
 * to a surface config is caught here instead of quietly becoming reachable.
 */
const routeSrc = fs.readFileSync(
  path.join(process.cwd(), 'src', 'app', 'api', 'harness', 'init', 'route.ts'),
  'utf8',
);

/** Every tool any surface exposes whose name says it writes. */
function writeToolsInUse(): string[] {
  const dir = path.join(process.cwd(), 'src', 'lib', 'surfaces');
  const names = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('-config.ts')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of text.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
      const name = m[1];
      if (/^(Write|Edit|NotebookEdit|ExcelWrite|ExcelEdit|Bash)$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

describe('the planning session is read-only', () => {
  it('found the surface configs, so this cannot pass on an empty set', () => {
    expect(writeToolsInUse().length).toBeGreaterThan(2);
  });

  it('denies every write tool the app actually uses', () => {
    for (const tool of writeToolsInUse()) {
      expect(
        PLANNER_DENIED,
        `${tool} is available to some surface but the planner does not deny it`,
      ).toContain(tool);
    }
  });

  it('uses deniedTools, not a narrowed allowedTools', () => {
    /*
     * `allowedTools` is an AUTO-APPROVE list — removing a name from it withholds
     * nothing, because the tool stays mounted and `canUseTool` falls through.
     * Four security toggles in this repo shipped making exactly that mistake and
     * all four had passing tests.
     */
    expect(routeSrc).toContain('deniedTools: PLANNER_DENIED');
  });

  it('says why, so the rule survives a tidy-up', () => {
    expect(routeSrc).toMatch(/auto-approve/i);
  });

  it('denies Bash, which is the hole a read-only list would leave', () => {
    // Read/Glob/Grep look harmless; Bash writes.
    expect(PLANNER_DENIED).toContain('Bash');
  });
});

import { VERIFIER_DENIED, VERIFIER_TOOLS } from './verifier';

/**
 * The verifier is the other session that must not be able to do the work.
 *
 * Its rule is stricter in one direction and looser in another than the
 * planner's: it KEEPS Bash, because running the checks is the job, and closes
 * that hole with the tree-unchanged rule instead.
 */
describe('the verifying session cannot write', () => {
  it('denies every write tool the app uses, except Bash', () => {
    for (const tool of writeToolsInUse()) {
      if (tool === 'Bash') continue;
      expect(
        VERIFIER_DENIED,
        `${tool} is available to some surface but the verifier does not deny it`,
      ).toContain(tool);
    }
  });

  it('keeps Bash, and the route closes that hole with a tree fingerprint', () => {
    expect(VERIFIER_TOOLS).toContain('Bash');
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', 'api', 'harness', 'route.ts'),
      'utf8',
    );
    expect(routeSrc).toContain('treeFingerprint');
    expect(routeSrc).toContain('git');
    expect(routeSrc).toContain('--porcelain');
  });

  it('the route hands the verifier deniedTools, not just a narrow allowedTools', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', 'api', 'harness', 'route.ts'),
      'utf8',
    );
    expect(routeSrc).toContain('deniedTools: VERIFIER_DENIED');
  });

  it('the route actually passes a verifier to the run', () => {
    // A verifier nothing uses is the phase-1 behaviour with extra code.
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', 'api', 'harness', 'route.ts'),
      'utf8',
    );
    expect(routeSrc).toMatch(/startRun\(\{[^}]*verify[^}]*\}\)/);
  });
});
