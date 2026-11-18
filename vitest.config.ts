import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest matches coverage globs against absolute paths with `contains: true`,
// so a bare '.claude/**' would also match a checkout that itself lives under
// .claude/worktrees/ and exclude everything. Anchor root-level dirs here.
const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Installs the Tauri-backed engine ports, as src/main.tsx does in the app.
    setupFiles: ['src/test/installEnginePorts.ts'],
    globals: true,
    // Node 25+ ships its own global localStorage, which without
    // --localstorage-file is undefined and shadows jsdom's, so jsdom tests
    // that touch it crash (CI's lts/* moved to Node 26 on 2026-11-02).
    execArgv: ['--no-experimental-webstorage'],
    // Coverage only runs with `npm run test:coverage` (--coverage); plain
    // `npm test` is unaffected.
    coverage: {
      provider: 'v8',
      include: [`${root}src/**/*.{ts,tsx}`],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/__snapshots__/**',
        '**/*.snap',
        '**/fixtures/**',
        '**/__fixtures__/**',
        // Test-support helpers, not app code.
        `${root}src/test/**`,
        `${root}src-tauri/**`,
        `${root}dist/**`,
        `${root}.claude/**`,
      ],
      reporter: ['text-summary', 'html'],
      // Ratchet: CI fails if coverage drops below the baseline measured when
      // coverage was introduced (rounded down to absorb noise). Raise these
      // by hand as coverage improves; never lower them. No autoUpdate.
      thresholds: {
        statements: 56.0,
        branches: 52.3,
        functions: 48.0,
        lines: 57.5,
      },
    },
  },
});
