import { defineConfig } from 'vitest/config';
import path from 'path';

// Firestore security-rules tests. These need the Firestore emulator, so they
// live outside the default `npm test` include and run via `npm run test:rules`
// (which wraps vitest in `firebase emulators:exec`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    globals: true,
    // Rules tests share one emulator instance; run files sequentially so
    // clearFirestore() calls in one file can't race another file's writes.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
