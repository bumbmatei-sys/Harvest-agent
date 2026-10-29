import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    // Process user-event through Vite so its host configuration uses the alias
    // below. The installed package still supplies all keyboard/input behavior.
    server: { deps: { inline: ['@testing-library/user-event'] } },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/utils/**', 'src/app/api/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Our DOM mount helpers supply act; no DOM-query package is needed for
      // user-event's host configuration in this dependency-pinned test setup.
      '@testing-library/dom': path.resolve(__dirname, './src/test/support/user-event-config.ts'),
      // The marker throws under Node's default export condition. Tests load
      // the server graph, so they resolve the empty test entry instead.
      'server-only': path.resolve(__dirname, './vendor/server-only/empty.js'),
    },
  },
});
