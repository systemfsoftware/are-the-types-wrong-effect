# @systemfsoftware/arethetypeswrong

> TypeScript package type-checking engine for auditing npm package entry points, module kinds, and export bindings across Node and bundler resolution modes.

Analyzes a package tarball the way Node and TypeScript will actually resolve it: entry-point discovery from `package.json` (`main`, `exports`, `bin`), per-entry `commonjs` / `ESM` resolution, and export-shape checks. Use it to catch publish-time mistakes locally instead of after `npm publish`.

## What it does

A single `Analysis.make(pkg).run` returns a structured report or a set of diagnostics. Each entry point is checked under every relevant resolution kind:

- **Entrypoint resolution** — does every `exports` subpath, `main`, and `bin` target resolve to a file that exists, and are `null`-target exclusions pruned correctly?
- **Module-kind agreement** — does the file's actual module kind (`commonjs` vs `ESM` vs `JSON`) match what the package's `type` and file extension imply?
- **Export bindings** — do named exports, default exports, and `export =` / `module.exports` line up between the type and implementation entry points?
- **CJS-only default** — flags a CJS file that only exports a default where an `esModuleInterop` consumer would get a wrapper.
- **Unexpected module syntax** — flags `import`/`export` in a CJS context and `require`/`module.exports` in an ESM context at the reported `pos`/`end`.
- **Internal resolution errors** — surfaces TypeScript's own resolution failures with the failing specifier and mode.

Results are typed with Effect Schema and carry `pos`/`end` for precise diagnostics.

## Install

```bash
pnpm add @systemfsoftware/arethetypeswrong
```

```bash
npm install @systemfsoftware/arethetypeswrong
```

Requires Node `>=24` and `typescript@^6.0.3` (the 6.x JS bridge — see [TypeScript version](#typescript-version)).

## Quick start

Check an in-memory package. `Analysis.make` returns a spec whose `run` is an Effect, so yield it into your own program:

```ts
import { Analysis } from '@systemfsoftware/arethetypeswrong'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'

const pkg = createPackage(
  {
    'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', type: 'module' }),
    'index.d.ts': 'export declare const x: number',
    'index.js': 'export const x = 1',
  },
  'demo',
  '1.0.0',
)

const check = Effect.gen(function*() {
  const report = yield* Analysis.make(pkg).run

  if ('entrypoints' in report) {
    return Object.keys(report.entrypoints) // [ "." ]
  }
  // report.types === false — the package ships no type declarations
  return []
})
```

Interpret that Effect once, at your program's edge: `yield*` it into a larger Effect, or run it with `runMain` (from `@effect/platform-node` / `@effect/platform-bun`) when the program terminates on its own.

Mount the same tree on an in-memory filesystem (keys stay `/node_modules/<name>/…`):

```ts
import { MemoryFileSystem } from '@systemfsoftware/effect-memfs'
import { toDirectoryJSON } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'

const tree = {
  'package.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
  'index.js': 'export const x = 1',
}
const contents = toDirectoryJSON(tree, 'demo')
// `contents` is a plain `Record<string, string|Uint8Array>` keyed by
// `/node_modules/demo/…`, e.g. `'/node_modules/demo/package.json'`
const filesystem = MemoryFileSystem.make(contents)

const readManifest = Effect.gen(function*() {
  const fs = yield* filesystem.effect
  const bytes = yield* fs.readFile('/node_modules/demo/package.json')
  return new TextDecoder().decode(bytes)
})
// `filesystem.effect` scopes the filesystem to one effect; provide `filesystem.layer`
// instead when the whole program should mount the same tree.
```

Check a real tarball on disk:

```ts
import { Analysis } from '@systemfsoftware/arethetypeswrong'
import { createPackageFromTarballData } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import * as FileSystem from 'effect/FileSystem'

const checkTarball = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const data = yield* fs.readFile('./my-package-1.2.3.tgz')
  return yield* Analysis.make(createPackageFromTarballData(data)).run
})
// `checkTarball` yields a `Report` (entrypoints + problems) or an `UntypedReport`
```

Filter entry points — still inside the same `Effect.gen`. Each option is a combinator on the spec:

```ts
const report = yield * Analysis.make(pkg).pipe(
  Analysis.includeEntrypoints(['./utils']),
  Analysis.excludeEntrypoints([/^\.\/internal\//]),
  Analysis.withEntrypoints(['.', './cli']), // exhaustive override
).run
```

Prefer the CLI for one-off checks. Add it to the project so your lockfile pins it, then run it through your package manager:

```bash
pnpm add -D @systemfsoftware/arethetypeswrong-cli
pnpm exec attw ./my-package-1.2.3.tgz
```

Its flags and profiles are documented in the
[CLI package](https://github.com/systemfsoftware/are-the-types-wrong-effect/tree/main/apps/arethetypeswrong-cli).

## Checks

| Check                       | What it reports                                                          |
| --------------------------- | ------------------------------------------------------------------------ |
| `entrypointResolutions`     | Missing or mis-resolving entry points from `exports` / `main` / `bin`    |
| `moduleKindDisagreement`    | File extension/`type` says ESM but file is CJS (or vice versa)           |
| `exportDefaultDisagreement` | `export default` present in types but not JS (or the reverse)            |
| `namedExports`              | Named export in types but not in JS (or the reverse)                     |
| `cjsOnlyExportsDefault`     | CJS file that only has `module.exports =` / `exports.default`            |
| `unexpectedModuleSyntax`    | ESM syntax in a CJS file or CJS syntax in an ESM file                    |
| `internalResolutionError`   | TypeScript failed to resolve a specifier under a given `resolution-mode` |

Each diagnostic includes `kind`, `entrypoint`, `resolutionKind` (`node10` / `node16` / `bundler`), and `pos`/`end` when applicable. See [`Problem.schema.ts`](./src/Problem.schema.ts) and [`Report.schema.ts`](./src/Report.schema.ts) for the full types.

## Configuration

No configuration file is required. Every option is a combinator on the spec `Analysis.make` returns, and `spec.run` yields the report:

```ts
const spec = Analysis.make(pkg).pipe(
  Analysis.withEntrypoints(['.', './cli']), // exhaustive list, disables auto-discovery
  Analysis.includeEntrypoints(['./utils']), // added to discovered entry points
  Analysis.excludeEntrypoints([/^\.\/internal\//]), // removed after discovery
  Analysis.withLegacyEntrypoints, // also consider all published files
)
// `spec.run` yields the `Report` (entrypoints + problems) or the `UntypedReport`
```

Entrypoint discovery reads `package.json` `exports`, `main`, `bin`, and `types`/`typings`. Published files are those not excluded by `.npmignore` / `files` / `.gitignore` semantics.

## TypeScript version

This package runs on the **TypeScript 6.x JS bridge** and requires `typescript@^6.0.3`. TypeScript 7 is a native Go compiler with no JS `createProgram` / `resolveModuleName` / `CompilerHost` API, so the analysis engine cannot run on it; 6.x is the last line carrying the full JS compiler surface.

Resolution traces embed the compiler version, so a report produced under a different TypeScript may differ in detail.

## Contributing

Development setup, build, and test workflow live in the repository.

## License

[Apache-2.0](./LICENSE)
