// Global test setup
import { beforeAll, afterAll } from 'vitest';

// Suppress console noise during tests
const originalLog = console.log;
const originalWarn = console.warn;

beforeAll(() => {
  console.log = (...args) => {
    if (!String(args[0] || '').includes('INIT')) {
      originalLog.apply(console, args);
    }
  };
});

afterAll(() => {
  console.log = originalLog;
  console.warn = originalWarn;
});
