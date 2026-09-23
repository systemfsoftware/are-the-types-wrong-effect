import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  packageManager: 'pnpm',
  reporters: ['progress', 'html', 'json', 'progress-stream'],
  htmlReporter: { fileName: 'reports/mutation-report.html' },
  jsonReporter: { fileName: 'reports/mutation-report.json' },
  coverageAnalysis: 'off',
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  ignorePatterns: ['reports', 'coverage', 'dist'],
  disableBail: true,
  cleanTempDir: 'always',
  thresholds: { high: 100, low: 100, break: 100 },
  testRunner: {
    plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    options: { configFile: 'vitest.config.ts', dir: '.', related: true },
  },
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
      options: { prioritizePerformanceOverAccuracy: true },
    },
  ],
  ignorers: [
    import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-in-source-vitest-block'),
  ],
  plugins: [import.meta.resolve('@systemfsoftware/stryker-test-contribution')],
  mutate: ['src/**/*.workflow.ts'],
  dryRunTimeoutMinutes: 10,
})
