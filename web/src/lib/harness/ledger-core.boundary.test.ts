import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * `ledger-core.ts` MUST stay importable from the renderer.
 *
 * Browser tools need the live webview, so a browsing run's loop executes
 * client-side. It reads and writes the same ledger, under the same rules, which
 * only works if those rules are reachable without dragging `node:fs` along.
 *
 * This is not a style preference. A client component that reaches `fs`
 * typechecks, passes every unit test, and fails only in `next build` — which
 * this repo has shipped once already: provider-manager.tsx -> lib/models/
 * credentials -> app-paths -> fs, with 2,777 tests green. `npm run verify`
 * includes the build for exactly that reason, but a test that names the file
 * fails in one second instead of ninety and says why.
 */

const CORE = resolve(__dirname, 'ledger-core.ts');
const core = readFileSync(CORE, 'utf8');

/** Anything that only exists on the server. */
const NODE_BUILTINS = /from ['"](node:)?(fs|path|crypto|os|child_process|net|http|https|stream|worker_threads)['"]/g;

describe('ledger-core is client-safe', () => {
  it('imports no node builtin', () => {
    const hits = [...core.matchAll(NODE_BUILTINS)].map((m) => m[0]);
    expect(hits, `ledger-core imports server-only modules: ${hits.join(', ')}`).toEqual([]);
  });

  it('imports nothing that transitively reaches one', () => {
    /*
     * One hop is enough to catch the realistic mistake — importing a sibling
     * that happens to be server-side. `store-fs` is the obvious trap, since it
     * sits next door and looks like part of the same thing.
     */
    const localImports = [...core.matchAll(/from ['"]\.\/([\w-]+)['"]/g)].map((m) => m[1]);
    for (const mod of localImports) {
      const sibling = readFileSync(resolve(__dirname, `${mod}.ts`), 'utf8');
      const hits = [...sibling.matchAll(NODE_BUILTINS)].map((m) => m[0]);
      expect(hits, `ledger-core -> ${mod} -> ${hits.join(', ')}`).toEqual([]);
    }
  });

  it('does not import the filesystem store', () => {
    // Named explicitly because it is the one an editor's auto-import will offer.
    expect(core).not.toContain('store-fs');
  });

  it('the fs half is NOT imported by any client component', () => {
    /*
     * The other direction. `ledger.ts` is allowed to touch fs; what it must not
     * do is end up in a client bundle. Type-only imports are fine — TypeScript
     * erases them — so this looks for value imports specifically.
     */
    const componentsDir = resolve(__dirname, '../../components');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.tsx$/.test(e.name)) {
          const text = readFileSync(full, 'utf8');
          /*
           * `import type { … }` is erased by TypeScript; a value import is not.
           *
           * `[^;\n]*` and not `[^;]*`: this codebase writes imports without
           * semicolons, so the greedy version spanned newlines and matched from
           * an unrelated `import { useEffect } from 'react'` several lines above
           * down to the ledger import — reporting a type-only import as an
           * offender. The test failed against correct code until this was fixed.
           */
          if (/^import\s+(?!type\s)[^;\n]*from ['"][^'"]*harness\/ledger['"]/m.test(text)) {
            offenders.push(full.split('/web/')[1] ?? full);
          }
        }
      }
    };
    walk(componentsDir);
    expect(offenders, `client components importing the fs-backed ledger: ${offenders}`).toEqual([]);
  });

  it('found real content, so the checks above are not vacuous', () => {
    expect(core.length).toBeGreaterThan(2000);
    expect(core).toContain('export function applySessionUpdate');
    expect(core).toContain('export function ledgerStateHash');
  });
});
