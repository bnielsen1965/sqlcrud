import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 10000,
    setupFiles: ['./tests/setup.js'],
  },
});
