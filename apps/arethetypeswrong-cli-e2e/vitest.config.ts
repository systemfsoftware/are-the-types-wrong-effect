import { defaultClientConditions, defaultServerConditions } from 'vite'
import { defineConfig } from 'vitest/config'

const SETUP_TIMEOUT_MS = 600_000
const TEST_TIMEOUT_MS = 120_000
const sourceCondition = '@systemfsoftware/source'

export default defineConfig({
  resolve: {
    conditions: [...defaultClientConditions, sourceCondition],
  },
  ssr: {
    resolve: {
      conditions: [...defaultServerConditions, sourceCondition],
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: SETUP_TIMEOUT_MS,
    teardownTimeout: 30_000,
    coverage: { enabled: false },
  },
})
