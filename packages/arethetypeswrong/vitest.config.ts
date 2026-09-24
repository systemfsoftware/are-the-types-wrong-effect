import { inlineSchemaTests } from '@systemfsoftware/effect-schema-vite'
import { defaultClientConditions, defaultServerConditions } from 'vite'
import { defineConfig } from 'vitest/config'

const sourceCondition = '@systemfsoftware/source'

// Ported from the monorepo's `@systemfsoftware/vitest-config`.
const isAgent = process.env['AGENT'] !== undefined
const isCI = !isAgent && typeof process.env['CI'] === 'string' && process.env['CI'].length > 0
const coverageReporters: Array<'json' | 'html' | 'lcov'> = ['json', 'html', 'lcov']
let sharedTestTimeout: number
if (isCI) {
  sharedTestTimeout = 30_000
} else if (isAgent) {
  sharedTestTimeout = 15_000
} else {
  sharedTestTimeout = 8_000
}

let silent: 'passed-only' | false = false
let bailOptions: { bail: number } | undefined
if (isAgent) {
  silent = 'passed-only'
  bailOptions = { bail: 1 }
}

const sharedConfig = {
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/.stryker-tmp/**', '**/node_modules/**', '**/.repo/**'],
    passWithNoTests: true,
    testTimeout: sharedTestTimeout,
    silent,
    ...bailOptions,
    coverage: {
      enabled: isCI || process.env['COVERAGE'] === 'true',
      provider: 'v8' as const,
      reporter: coverageReporters,
    },
  },
}

export default defineConfig({
  ...sharedConfig,
  resolve: {
    conditions: [...defaultClientConditions, sourceCondition],
  },
  ssr: {
    resolve: {
      conditions: [...defaultServerConditions, sourceCondition],
    },
  },
  plugins: [inlineSchemaTests()],
  test: {
    ...sharedConfig.test,
    include: [
      'tests/**/*.test.ts',
      'src/schema-laws.test.ts',
      'src/__tests__/*.workflow.property.test.ts',
      'src/__tests__/*.refusal.test.ts',
    ],
    exclude: sharedConfig.test.exclude,
    includeSource: ['src/**/*.ts'],
    setupFiles: ['vitest-setup.ts'],
  },
})
