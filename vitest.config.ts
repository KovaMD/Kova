import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    // Node 25+ ships its own global localStorage, which without
    // --localstorage-file is undefined and shadows jsdom's, so jsdom tests
    // that touch it crash (CI's lts/* moved to Node 26 on 2026-11-02).
    execArgv: ['--no-experimental-webstorage'],
  },
});
