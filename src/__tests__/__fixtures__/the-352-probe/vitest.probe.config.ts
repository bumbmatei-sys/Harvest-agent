import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * THE-352 — the config for the probe suites, and ONLY for them.
 *
 * ⚠️ These files answer "what does Vitest DO when a hook throws", which cannot
 * be asked from inside a passing run: a suite cannot observe its own tests being
 * skipped. So they are run as a CHILD vitest process and their JSON report is
 * read back by `THE-352.suite-guards.test.ts`.
 *
 * 🔴 `.probe.ts`, NOT `.test.ts`. The repo config collects `src/**\/*.test.{ts,tsx}`,
 * and a probe that deliberately throws in `beforeAll` would be a permanent red
 * in the real suite if it were collected there. The extension keeps them out of
 * it, and this config is the only thing that picks them up.
 */
export default defineConfig({
  test: {
    root: path.resolve(__dirname, '../../../..'),
    include: ['src/__tests__/__fixtures__/the-352-probe/**/*.probe.ts'],
    environment: 'node',
    // No `setupFiles`: the repo's setup is written for happy-dom and these
    // probes measure hook semantics, which nothing in it affects.
    globals: false,
    // One file at a time, so the report is deterministic and a probe that
    // spawns a process cannot race another probe's.
    fileParallelism: false,
  },
});
