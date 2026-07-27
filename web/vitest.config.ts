import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // Root-level .js is included for the Electron-side modules that must sit
    // beside main-web.js to be picked up by electron-builder's `files` allowlist
    // (credential-key.js), so their tests can live next to them.
    include: ['src/**/*.test.{ts,tsx}', '*.test.{js,ts}'],
    environment: 'node',
  },
});
