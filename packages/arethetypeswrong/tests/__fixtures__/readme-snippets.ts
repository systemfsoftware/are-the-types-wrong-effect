import { Analysis } from '@systemfsoftware/arethetypeswrong'
import { MemoryFileSystem } from '@systemfsoftware/effect-memfs'
import { createPackage, createPackageFromTarballData, toDirectoryJSON } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import * as FileSystem from 'effect/FileSystem'

const demoPackage = createPackage(
  {
    'package.json': '{ "name": "demo", "version": "1.0.0", "type": "module" }',
    'index.d.ts': 'export declare const x: number',
    'index.js': 'export const x = 1',
  },
  'demo',
  '1.0.0',
)

export const entrypointNames = Effect.gen(function*() {
  const report = yield* Analysis.make(demoPackage).run

  if ('entrypoints' in report) {
    return Object.keys(report.entrypoints)
  }
  return []
})

export const tarballReport = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const data = yield* fs.readFile('./my-package-1.2.3.tgz')
  return yield* Analysis.make(createPackageFromTarballData(data)).run
})

const tree = {
  'package.json': '{ "name": "demo", "version": "1.0.0" }',
  'index.js': 'export const x = 1',
}
const contents = toDirectoryJSON(tree, 'demo')
const filesystem = MemoryFileSystem.make(contents)

export const manifestText = Effect.gen(function*() {
  const fs = yield* filesystem.effect
  const bytes = yield* fs.readFile('/node_modules/demo/package.json')
  return new TextDecoder().decode(bytes)
})

export const filteredReport = Analysis.make(demoPackage).pipe(
  Analysis.withEntrypoints(['.', './cli']),
  Analysis.includeEntrypoints(['./utils']),
  Analysis.excludeEntrypoints([/^\.\/internal\//]),
).run

const companionPackage = createPackage(
  {
    'package.json': '{ "name": "@types/demo", "version": "1.0.0" }',
    'index.d.ts': 'export declare const x: number',
  },
  '@types/demo',
  '1.0.0',
)

export const configuredSpec = Analysis.withLegacyEntrypoints(
  Analysis.withTypesCompanion(Analysis.make(demoPackage), companionPackage),
)

export const describedFailure = Effect.catchTags(Analysis.make(demoPackage).run, {
  ManifestUnreadable: () => Effect.succeed('the package manifest could not be read'),
  CompilerFailed: () => Effect.succeed('TypeScript could not build the program'),
  LexerUnavailable: () => Effect.succeed('the CommonJS lexer could not be initialized'),
  EntrypointsAllExcluded: () => Effect.succeed('the exclusions left no entrypoint to analyze'),
})
