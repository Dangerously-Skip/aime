import { defineConfig } from 'vitest/config';
import base from './vitest.config';

/**
 * Config for the P7 craft evals — `npm run eval:baseline`.
 *
 * Separate from the main config on purpose. `*.eval.ts` is deliberately outside
 * the normal `include`, because these files make REAL model calls and cost real
 * money: an eval that a stray `npm test` can trigger is one that surprises
 * someone's bill. (The eval also refuses to run without `AIME_EVAL=1`, so this
 * is the second of two locks, not the only one.)
 *
 * The timeout is the other reason. A single brief is a full agent turn — think,
 * write files, iterate — which is minutes, not the 30s the unit suite allows.
 * Raising that globally would blunt the unit suite's ability to catch a hang.
 */
/**
 * Spread rather than `mergeConfig`: that helper CONCATENATES arrays, so merging
 * an `include` produced "the whole unit suite, plus the evals" — the opposite of
 * the isolation this file exists for. Inheriting `resolve` still avoids
 * duplicating the `server-only` alias, which is the part worth sharing.
 */
export default defineConfig({
  resolve: base.resolve,
  test: {
    ...base.test,
    include: ['src/**/*.eval.ts'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    // One brief at a time: they each drive an agent that writes files and burns
    // tokens, and interleaving them makes the per-brief durations in the report
    // meaningless.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
