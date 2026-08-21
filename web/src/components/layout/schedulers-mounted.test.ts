import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A HOOK THAT SUBSCRIBES TO THE MINUTE TICK MUST BE MOUNTED SOMEWHERE.
 *
 * `useCron` was written, tested, and never called from anywhere. Cron jobs could
 * be created, listed and toggled in Customize and in a project's settings, and
 * they never fired — not once, for any user. The hook was dead code with a
 * passing test suite, and nothing about the feature looked broken from outside:
 * the UI worked, the store persisted, the tests were green.
 *
 * That is this codebase's signature failure at feature scale — wired, correct,
 * unreachable — and it is invisible to every other kind of test. A unit test
 * proves the hook fires when a tick arrives. Only this asks whether any tick can
 * reach it.
 *
 * DERIVED from the hooks directory rather than a hand-written list, so a new
 * scheduler cannot be quietly born dead.
 */

const SRC = path.join(process.cwd(), 'src');
const HOOKS = path.join(SRC, 'hooks');

/** Every source file under src/, excluding tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Hooks that subscribe to the minute tick, by their exported name.
 *
 * A hook is a scheduler if it reaches `onMinuteTick`. `use-electron` is the
 * BRIDGE that exposes it and is excluded: it publishes the tick rather than
 * acting on one.
 */
function schedulerHooks(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  for (const file of sourceFiles(HOOKS)) {
    if (path.basename(file) === 'use-electron.ts') continue;
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('onMinuteTick')) continue;
    for (const m of src.matchAll(/export function (use[A-Z]\w*)/g)) {
      out.push({ name: m[1], file: path.relative(SRC, file) });
    }
  }
  return out;
}

/** Files that could mount a hook: components and app routes. */
const mountSites = (): string[] =>
  [...sourceFiles(path.join(SRC, 'components')), ...sourceFiles(path.join(SRC, 'app'))];

/** Does anything actually CALL this hook? */
function isMounted(hook: string): string | null {
  const call = new RegExp(`\\b${hook}\\s*\\(`);
  for (const file of mountSites()) {
    // Its own definition does not count, and neither does an import line.
    const src = fs
      .readFileSync(file, 'utf8')
      .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '');
    if (call.test(src)) return path.relative(SRC, file);
  }
  return null;
}

/**
 * Is the file that calls the hook itself rendered by anything?
 *
 * ONE LEVEL, not full reachability. Removing `<Schedulers />` from the shell used
 * to leave every per-hook check green: `schedulers.tsx` still CALLS `useCron`,
 * so the hook had a call site — in a component nobody rendered. A dead host is
 * as dead as a dead hook.
 *
 * A complete answer would walk the render tree to the root. This catches the
 * orphan-host case, which is the one that actually happened, and the shell check
 * below pins the specific host.
 */
function hostIsRendered(hostFile: string): boolean {
  const base = path.basename(hostFile).replace(/\.tsx?$/, '');
  const componentName = fs
    .readFileSync(path.join(SRC, hostFile), 'utf8')
    .match(/export function ([A-Z]\w*)/)?.[1];
  for (const file of mountSites()) {
    if (path.relative(SRC, file) === hostFile) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (componentName && new RegExp(`<${componentName}[\\s/>]`).test(src)) return true;
    /*
     * A surface is reached through the router's REGISTRY rather than a JSX tag,
     * so an import of the module counts as rendering it. Quote-agnostic: the
     * first version matched only single quotes and reported every surface as
     * dead, which is a test failing on its own punctuation.
     */
    if (new RegExp(`from ['\"][^'\"]*/${base}['\"]`).test(src)) return true;
  }
  return false;
}

describe('every minute-tick scheduler is reachable', () => {
  it('finds the schedulers, so the checks below are not vacuous', () => {
    const found = schedulerHooks().map((h) => h.name);
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found).toContain('useCron');
    expect(found).toContain('useStandingOrders');
  });

  it.each(schedulerHooks())('$name ($file) is mounted', ({ name }) => {
    /*
     * The failure this catches, in the words it should fail with: the hook
     * exists, its tests pass, and no tick will ever reach it because nothing
     * renders it.
     */
    const host = isMounted(name);
    expect(
      host,
      `${name} subscribes to the minute tick but nothing calls it — the feature is dead`,
    ).not.toBeNull();

    // And the caller is itself rendered — a call site inside an orphan component
    // is exactly as dead, and used to pass this test.
    expect(
      hostIsRendered(host!),
      `${name} is called in ${host}, but nothing renders ${host} — still dead`,
    ).toBe(true);
  });
});

describe('where the shared schedulers live', () => {
  const shell = fs.readFileSync(path.join(SRC, 'components/layout/app-shell.tsx'), 'utf8');

  it('the shell renders them', () => {
    /*
     * In the SHELL, not in a surface. `useStandingOrders` lives in the Assistant
     * surface and works — but only because the router happens to mount every
     * surface at once. That is a property of the routing, not of the hook, and a
     * scheduler that stops firing when someone reorganises the routing is a
     * scheduler that will stop firing.
     */
    expect(shell).toContain('<Schedulers />');
  });

  it('the schedulers component renders nothing', () => {
    // It exists to run effects. Anything visual in here would be laid out by the
    // shell in a place nobody chose.
    const s = fs.readFileSync(path.join(SRC, 'components/layout/schedulers.tsx'), 'utf8');
    expect(s).toMatch(/return null;/);
  });
});
