import { inlineSchemaTests } from '@systemfsoftware/effect-schema-vite'
import { defaultClientConditions, defaultServerConditions } from 'vite'
import { defineConfig } from 'vitest/config'

import { readFileSync } from 'node:fs'

import { Result, Schema } from 'effect'

const ManifestVersion = Schema.fromJsonString(Schema.Struct({ version: Schema.String }))
const { version } = Result.getOrThrow(
  Schema.decodeResult(ManifestVersion)(readFileSync(new URL('./package.json', import.meta.url), 'utf8')),
)
const cliVersionDefine = {
  __ATTW_CLI_VERSION__: Result.getOrThrow(Schema.encodeResult(Schema.fromJsonString(Schema.String))(version)),
}

const sourceCondition = '@systemfsoftware/source'

// Ported from the monorepo's `@systemfsoftware/vitest-config`.
const isAgent = process.env['AGENT'] !== undefined
const isCI = !isAgent && typeof process.env['CI'] === 'string' && process.env['CI'].length > 0
const coverageReporters: Array<'json' | 'html' | 'lcov'> = ['json', 'html', 'lcov']
let sharedTestTimeout = 8_000
if (isAgent) sharedTestTimeout = 15_000
if (isCI) sharedTestTimeout = 30_000
let silentOption: false | 'passed-only' = false
if (isAgent) silentOption = 'passed-only'
let bailOption: { readonly bail?: number } = {}
if (isAgent) bailOption = { bail: 1 }

const sharedConfig = {
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/.stryker-tmp/**', '**/node_modules/**', '**/.repo/**'],
    passWithNoTests: true,
    testTimeout: sharedTestTimeout,
    silent: silentOption,
    ...bailOption,
    coverage: {
      enabled: isCI || process.env['COVERAGE'] === 'true',
      provider: 'v8' as const,
      reporter: coverageReporters,
    },
  },
}

export default defineConfig({
  ...sharedConfig,
  define: cliVersionDefine,
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
    include: ['src/**/*.test.ts', 'tests/**/*.integration.test.ts'],
    includeSource: ['src/**/*.ts'],
    setupFiles: ['vitest-setup.ts'],
  },
})
