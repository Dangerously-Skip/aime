import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      /**
       * `server-only` is a guard for the BUNDLER, not for Node. Its main entry
       * throws on import; Next resolves it to a no-op under the `react-server`
       * condition, which vitest does not set — so every test touching a
       * server-marked module blew up with "This module cannot be imported from a
       * Client Component module".
       *
       * Aliased to the package's own empty entry, which is exactly what Next
       * substitutes on the server. The guard still does its job where it matters:
       * `next build` fails if a client component imports one of these.
       */
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    // Root-level .js is included for the Electron-side modules that must sit
    // beside main-web.js to be picked up by electron-builder's `files` allowlist
    // (credential-key.js), so their tests can live next to them.
    //
    // `scripts/` is included because what lives there is not incidental tooling:
    // `dev-with-port.js` chooses the dev server's PORT, and the port is the
    // ORIGIN, and the origin is which localStorage profile the app sees. A bug
    // there presents as data loss. A test for it that silently never ran would
    // be worse than none.
    include: ['src/**/*.test.{ts,tsx}', '*.test.{js,ts}', 'scripts/**/*.test.{js,ts}'],
    environment: 'node',
    /**
     * Vitest's 5s default is a fast-laptop assumption. The suite runs in ~14s
     * locally and took 197s on the self-hosted runner — three runners share one
     * Contabo box with every other repo in the org, so per-test wall-clock is
     * roughly an order of magnitude worse. Five tests failed there purely on the
     * timeout: the fast-check property suites (which do 2000 runs) and the SSE
     * route test.
     *
     * Raised rather than made conditional on CI: a timeout that only bites in one
     * environment is a test that passes locally and fails on push, which is the
     * least useful place to find out. These numbers still catch a genuine hang —
     * nothing here should take 20s of real work.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
