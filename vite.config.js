import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'renderer',
  base: './',
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        chat: resolve(__dirname, 'renderer/chat/index.html'),
        cowork: resolve(__dirname, 'renderer/cowork/index.html'),
        code: resolve(__dirname, 'renderer/code/index.html'),
        browser: resolve(__dirname, 'renderer/browser/index.html'),
        sidebar: resolve(__dirname, 'renderer/sidebar/index.html'),
        tabbar: resolve(__dirname, 'renderer/tabbar/index.html'),
      },
    },
    target: 'chrome130',
  },
  server: {
    port: 5173,
  },
});
