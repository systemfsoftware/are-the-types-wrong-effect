# @systemfsoftware/arethetypeswrong

> TypeScript package type-checking engine for auditing npm package entry points, module kinds, and export bindings across Node and bundler resolution modes.

Analyzes a package the way Node and TypeScript will actually resolve it: entry-point discovery from `package.json` (`main`, `exports`, `bin`), per-entry `commonjs` / `ESM` resolution, and export-shape checks. Use it to catch publish-time mistakes locally instead of after `npm publish`.

## What it does

`Analysis.make(pkg).run` yields one report. Each entry point is resolved under every resolution kind — `node10`, `node16-cjs`, `node16-esm`, and `bundler` — and each resolution is checked for agreement between the type entry point and the implementation entry point. Problems come back as schema-typed variants carrying `pos` / `end` wherever the offending syntax is a source position.

## Install

```bash
pnpm add @systemfsoftware/arethetypeswrong
```

```bash
npm install @systemfsoftware/arethetypeswrong
```

Requires Node `>=24` and `typescript@^6.0.3` (the 6.x JS bridge — see [TypeScript version](#typescript-version)).

## Quick Start

`Analysis.make` takes an `@systemfsoftware/npm-package` `Package` and returns a spec; `spec.run` is an Effect that yields the report. Build a package from an authored tree, analyze it, and read the entry points back out:

```ts
import { Analysis } from '@systemfsoftware/arethetypeswrong'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'

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
```

`report.entrypoints` maps each subpath to what it resolved to under each resolution kind, and `report.problems` is what failed. A package that ships no type declarations yields an `UntypedReport` instead — `report.types` is `false` and only the package name and version are present.

Interpret that Effect once, at your program's edge: `yield*` it into a larger Effect, or run it with `runMain` (from `@effect/platform-node` / `@effect/platform-bun`) when the program terminates on its own.

Analyze a tarball you already have on disk:

```ts
import { Analysis } from '@systemfsoftware/arethetypeswrong'
import { createPackageFromTarballData } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import * as FileSystem from 'effect/FileSystem'

export const tarballReport = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const data = yield* fs.readFile('./my-package-1.2.3.tgz')
  return yield* Analysis.make(createPackageFromTarballData(data)).run
})
```

Or mount the same authored tree on an in-memory filesystem, for reads of your own. Keys keep the `/node_modules/<name>/…` prefix `createPackage` uses:

```ts
import { MemoryFileSystem } from '@systemfsoftware/effect-memfs'
import { toDirectoryJSON } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'

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
```

`filesystem.effect` scopes the filesystem to one effect; provide `filesystem.layer` instead when the whole program should mount the same tree.

Every snippet on this page compiles with the package: [`tests/__fixtures__/readme-snippets.ts`](./tests/__fixtures__/readme-snippets.ts).

## Architecture

An analysis is one composed cell. Every outside interaction inside it has the same five phases: **read** the bytes or text, **decode** them through an Effect Schema codec, **decide** with one pure workflow, **encode** the decision back into schema-shaped data, and **write** the effect the decision asked for. `Analysis.make(pkg).run` threads three cells together:

| Stage               | What it does                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open the package    | Reads `package.json`, decodes it through the manifest codec, and decides the entry-point set in `discover-entrypoints.workflow.ts` from `exports`, `main`, `bin`, and the published files. A package with no type declarations short-circuits to the untyped report here. |
| Compile the package | Opens one handle that owns the TypeScript program set for the package — compiler host, module-resolution state, and lexer are created once — and resolves every entry point under every resolution kind from it.                                                          |
| Detect problems     | Fans out one cell per problem family. Each family reads a plain, schema-encodable observation from the handle, decides with its own workflow, and writes the problems it found. The report is assembled from those decisions.                                             |

The handle is a branded, pipeable record that keeps the TypeScript objects in module-private symbol slots. A compiler object never crosses a phase boundary, and nothing outside the engine can read the program set.

There is one workflow per problem family: entrypoint resolution, module-kind disagreement, export-default disagreement, named exports, CJS-only default, unexpected module syntax, internal resolution errors, and fallback conditions. Each is a single `Workflow.make` of cyclomatic complexity 1, so a family's rule reads — and property-tests — as a pure function from an observation to a decision. Observation stays in the cell that reads the handle; classification stays in the workflow.

## Builder combinators

`Analysis.make` returns an immutable spec. Every combinator returns a new spec, and the only way to execute one is its terminal `.run`.

| Combinator                              | What it does                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Analysis.make(pkg)`                    | The identity entry point. `pkg` is an `@systemfsoftware/npm-package` `Package` — from an authored tree, a tarball, or a client of your own.  |
| `Analysis.withEntrypoints(names)`       | Exhaustive override: analyze exactly these subpaths and skip discovery.                                                                      |
| `Analysis.includeEntrypoints(names)`    | Add subpaths to the discovered set.                                                                                                          |
| `Analysis.excludeEntrypoints(patterns)` | Remove subpaths from the discovered set. Each pattern is a subpath string or a `RegExp`, and the regex form removes from the discovered set. |
| `Analysis.withTypesCompanion(pkg)`      | Take the types from a companion package, the way `@types/*` consumers do; the report then says where its types came from.                    |
| `Analysis.withLegacyEntrypoints(spec)`  | In a package with no `exports`, also consider every published code file. Takes the spec as its only argument.                                |
| `spec.run`                              | The terminal execution: an `Effect<PackageReport, AnalysisError>` with no requirements left to provide.                                      |

The spec also carries `.withEntrypoints`, `.includeEntrypoints`, `.excludeEntrypoints`, and `.withTypesCompanion` as methods. Both forms of the four dual combinators build the same spec, so a configuration threads through either — both snippets below continue from the `demoPackage` built above:

```ts
import { Analysis } from '@systemfsoftware/arethetypeswrong'

export const filteredReport = Analysis.make(demoPackage).pipe(
  Analysis.withEntrypoints(['.', './cli']),
  Analysis.includeEntrypoints(['./utils']),
  Analysis.excludeEntrypoints([/^\.\/internal\//]),
).run
```

And the two single-form options on a spec of their own:

```ts
import { Analysis } from '@systemfsoftware/arethetypeswrong'
import { createPackage } from '@systemfsoftware/npm-package'

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
```

Entrypoint discovery reads `package.json` `exports`, `main`, `bin`, and `types` / `typings`. Published files are those not excluded by `.npmignore` / `files` / `.gitignore` semantics.

## Problem kinds

Every problem is a tagged variant of one union, and its `kind` names it. `Problem.schema.ts` is the source of truth, and the problem schemas and their kinds are exported, so a problem document decodes outside this package.

| Kind                      | What it reports                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `NoResolution`            | No file resolved for the entry point under a resolution kind.                                        |
| `UntypedResolution`       | The entry point resolved to a file with no type declarations.                                        |
| `FalseESM`                | The types resolve as ESM where the implementation is CJS.                                            |
| `FalseCJS`                | The types resolve as CJS where the implementation is ESM.                                            |
| `CJSResolvesToESM`        | A CJS entry point resolves to an ESM file, which CJS consumers can only reach through `import()`.    |
| `NamedExports`            | Named exports in the types are missing from the implementation, or the types export no names at all. |
| `FallbackCondition`       | The resolution took a fallback branch of the `exports` map.                                          |
| `FalseExportDefault`      | The types declare a default export the implementation does not have.                                 |
| `MissingExportEquals`     | The implementation uses `export =` semantics the types do not declare.                               |
| `UnexpectedModuleSyntax`  | The file contains module syntax that contradicts its detected module kind, at the reported position. |
| `InternalResolutionError` | TypeScript could not resolve a module specifier one of the package's own files references.           |
| `CJSOnlyExportsDefault`   | A CJS file whose only export is a default, which `esModuleInterop` consumers receive wrapped.        |

## Failure model

The engine names exactly three failures, and each arrives as a tagged error on the Effect's error channel — `spec.run` reports them as values, not exceptions. All three carry an optional `cause`.

| Failure              | Raised when                                                |
| -------------------- | ---------------------------------------------------------- |
| `ManifestUnreadable` | The package manifest could not be read or decoded.         |
| `CompilerFailed`     | The TypeScript program for the package could not be built. |
| `LexerUnavailable`   | The CommonJS lexer could not be initialized.               |

Handle them with `Effect.catchTags`, or let them propagate to the edge:

```ts
import { Analysis } from '@systemfsoftware/arethetypeswrong'
import { Effect } from 'effect'

export const describedFailure = Effect.catchTags(Analysis.make(demoPackage).run, {
  ManifestUnreadable: () => Effect.succeed('the package manifest could not be read'),
  CompilerFailed: () => Effect.succeed('TypeScript could not build the program'),
  LexerUnavailable: () => Effect.succeed('the CommonJS lexer could not be initialized'),
})
```

## Verification

- **One property suite per workflow.** `src/__tests__/*.workflow.property.test.ts` proves each decision as a universal over generated commands, from the observation shape it accepts to the decision it returns.
- **Schema laws with refusal suites beside them.** The generated laws cover what each schema accepts; an authored refusal suite next to each refined schema pins what it rejects.
- **Recipe pins.** Every problem kind is pinned against a synthetic package from `@systemfsoftware/arethetypeswrong-recipes`, at the entry point and resolution kind where that kind is authored — so a rebuild that stops reporting one fails the suite.
- **Mutation at 100.** The mutation gate runs over the `*.workflow.ts` files at a threshold of 100, so a decision whose branch no test can kill fails the gate rather than passing quietly.

## TypeScript version

This package runs on the **TypeScript 6.x JS bridge** and requires `typescript@^6.0.3`. TypeScript 7 is a native Go compiler with no JS `createProgram` / `resolveModuleName` / `CompilerHost` API, so the analysis engine cannot run on it; 6.x is the last line carrying the full JS compiler surface.

Resolution traces embed the compiler version, so a report produced under a different TypeScript may differ in detail.

## Contributing

Development setup, build, and test workflow live in the repository.

## License

[Apache-2.0](./LICENSE)
