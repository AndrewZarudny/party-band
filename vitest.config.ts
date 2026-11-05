import { defineConfig } from 'vitest/config'

// Plain Node tests for the pure logic: no app plugins, no DOM. Browser globals a module needs are shimmed in the test.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
})
