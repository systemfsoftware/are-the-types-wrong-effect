import type { Package } from '@systemfsoftware/npm-package'
import { init as initCjsLexer } from 'cjs-module-lexer'
import { Effect, Option, Predicate } from 'effect'
import { dual } from 'effect/Function'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import ts from 'typescript'
import { CompilerFailed, LexerUnavailable } from './AnalysisError.schema.js'
import { type CompilerHost, type CompilerHosts, createCompilerHosts } from './internal/compiled-package-hosts.js'
import { getEsmModuleNamespace } from './internal/module-namespace.js'
import { resolutionOptionOf } from './internal/resolution-option.js'
import type { ModuleKind, ResolutionKind, ResolutionOption } from './Problem.schema.js'

export const TypeId = Symbol.for('~systemfsoftware/arethetypeswrong/CompiledPackage')
export type TypeId = typeof TypeId

const StateId: unique symbol = Symbol.for('~systemfsoftware/arethetypeswrong/CompiledPackage/state')

export interface ResolvedModuleView {
  readonly fileName: string
  readonly isTypeScript: boolean
  readonly isJson: boolean
  readonly trace: readonly string[]
}

export interface ResolvedModulePair {
  readonly isWildcard: boolean
  readonly types: ResolvedModuleView | undefined
  readonly implementation: ResolvedModuleView | undefined
}

export interface ResolvedEntrypoint extends ResolvedModulePair {
  readonly files: readonly string[] | undefined
}

interface CompiledPackageState {
  readonly pkg: Package
  readonly hosts: CompilerHosts
}

export interface CompiledPackage extends Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly [StateId]: CompiledPackageState
  readonly packageName: string
}

export const isCompiledPackage = (value: unknown): value is CompiledPackage => Predicate.hasProperty(value, TypeId)

export const open = (pkg: Package): Effect.Effect<CompiledPackage, CompilerFailed | LexerUnavailable> =>
  Effect.gen(function*() {
    yield* initializeLexer
    const hosts = yield* createCompilerHosts(pkg)
    return makeCompiledPackage(pkg, hosts)
  })

const initializeLexer: Effect.Effect<void, LexerUnavailable> = Effect.asVoid(
  Effect.tryPromise({
    try: () => initCjsLexer(),
    catch: (cause) => new LexerUnavailable({ cause }),
  }),
)

const makeCompiledPackage = (pkg: Package, hosts: CompilerHosts): CompiledPackage => ({
  [TypeId]: TypeId,
  [StateId]: { pkg, hosts },
  packageName: pkg.packageName,
  ...Prototype,
})

const stateOf = (self: CompiledPackage): CompiledPackageState => self[StateId]

const hostOf = (self: CompiledPackage, resolutionOption: ResolutionOption): CompilerHost =>
  stateOf(self).hosts[resolutionOption]

export const hostFor: {
  (resolutionOption: ResolutionOption): (self: CompiledPackage) => CompilerHost
  (self: CompiledPackage, resolutionOption: ResolutionOption): CompilerHost
} = dual(2, (self: CompiledPackage, resolutionOption: ResolutionOption): CompilerHost => hostOf(self, resolutionOption))

export const hostForFiles: {
  (files: readonly string[]): (self: CompiledPackage) => CompilerHost | undefined
  (self: CompiledPackage, files: readonly string[]): CompilerHost | undefined
} = dual(
  2,
  (self: CompiledPackage, files: readonly string[]): CompilerHost | undefined =>
    stateOf(self).hosts.findHostForFiles(files),
)

export const inspectionHost: {
  (fileName: string): (self: CompiledPackage) => CompilerHost
  (self: CompiledPackage, fileName: string): CompilerHost
} = dual(2, (self: CompiledPackage, fileName: string): CompilerHost => {
  const hosts = stateOf(self).hosts
  return hosts.findHostForFiles([fileName]) ?? hosts.bundler
})

interface ModuleKindQuery {
  readonly fileName: string | undefined
  readonly resolutionOption: ResolutionOption
}

export const moduleKindOf: {
  (query: ModuleKindQuery): (self: CompiledPackage) => ModuleKind | undefined
  (self: CompiledPackage, query: ModuleKindQuery): ModuleKind | undefined
} = dual(
  2,
  (self: CompiledPackage, query: ModuleKindQuery): ModuleKind | undefined =>
    Option.getOrUndefined(moduleKindOptionOf(self, query)),
)

const moduleKindOptionOf = (self: CompiledPackage, query: ModuleKindQuery): Option.Option<ModuleKind> =>
  Option.flatMap(
    Option.fromNullishOr(query.fileName),
    (fileName) => Option.fromNullishOr(hostOf(self, query.resolutionOption).getModuleKindForFile(fileName)),
  )

interface EntrypointQuery {
  readonly entrypoint: string
  readonly resolutionKind: ResolutionKind
}

export const resolveModulePair: {
  (query: EntrypointQuery): (self: CompiledPackage) => ResolvedModulePair
  (self: CompiledPackage, query: EntrypointQuery): ResolvedModulePair
} = dual(2, (self: CompiledPackage, query: EntrypointQuery): ResolvedModulePair => {
  if (isWildcardEntrypoint(query.entrypoint)) {
    return { isWildcard: true, types: undefined, implementation: undefined }
  }
  return resolveNamedEntrypoint(self, query)
})

export const resolveEntrypoint: {
  (query: EntrypointQuery): (self: CompiledPackage) => Effect.Effect<ResolvedEntrypoint>
  (self: CompiledPackage, query: EntrypointQuery): Effect.Effect<ResolvedEntrypoint>
} = dual(
  2,
  (self: CompiledPackage, query: EntrypointQuery): Effect.Effect<ResolvedEntrypoint> =>
    resolvedEntrypointOf(self, query),
)

const resolvedEntrypointOf = (
  self: CompiledPackage,
  query: EntrypointQuery,
): Effect.Effect<ResolvedEntrypoint> =>
  Effect.gen(function*() {
    const pair = resolveModulePair(self, query)
    return yield* attachProgramFiles(self, query.resolutionKind, pair)
  })

const attachProgramFiles = (
  self: CompiledPackage,
  resolutionKind: ResolutionKind,
  pair: ResolvedModulePair,
): Effect.Effect<ResolvedEntrypoint> => {
  const typesFileName = typesFileNameOf(pair)
  if (typesFileName === undefined) {
    return Effect.succeed({ ...pair, files: undefined })
  }
  return Effect.map(
    hostOf(self, resolutionOptionOf(resolutionKind)).createPrimaryProgram(typesFileName),
    (program): ResolvedEntrypoint => ({ ...pair, files: program.getSourceFiles().map((file) => file.fileName) }),
  )
}

const typesFileNameOf = (pair: ResolvedModulePair): string | undefined => pair.types?.fileName

export const esmNamespaceOf: {
  (specifier: string): (self: CompiledPackage) => readonly string[] | undefined
  (self: CompiledPackage, specifier: string): readonly string[] | undefined
} = dual(2, (self: CompiledPackage, specifier: string): readonly string[] | undefined =>
  Option.getOrUndefined(
    Option.liftThrowable(getEsmModuleNamespace)({ pkg: stateOf(self).pkg, specifier }),
  ))

export interface BoundTypesProgram {
  readonly checker: ts.TypeChecker
  readonly typesSourceFile: ts.SourceFile
}

export const typesProgramOf: {
  (fileName: string): (self: CompiledPackage) => Effect.Effect<BoundTypesProgram | undefined>
  (self: CompiledPackage, fileName: string): Effect.Effect<BoundTypesProgram | undefined>
} = dual(
  2,
  (self: CompiledPackage, fileName: string): Effect.Effect<BoundTypesProgram | undefined> =>
    boundTypesProgramOf(self, fileName),
)

const boundTypesProgramOf = (
  self: CompiledPackage,
  fileName: string,
): Effect.Effect<BoundTypesProgram | undefined> =>
  Effect.map(primedTypesProgram(self, fileName), (program) => boundProgramOption(program, fileName))

const primedTypesProgram = (self: CompiledPackage, fileName: string): Effect.Effect<ts.Program> =>
  Effect.tap(
    hostOf(self, 'node16').createAuxiliaryProgram([fileName]),
    (program) => Effect.sync(() => program.getTypeChecker()),
  )

const boundProgramOption = (program: ts.Program, fileName: string): BoundTypesProgram | undefined => {
  const typesSourceFile = program.getSourceFile(fileName)
  if (typesSourceFile === undefined) {
    return undefined
  }
  return { checker: program.getTypeChecker(), typesSourceFile }
}

export interface BoundModuleSources {
  readonly typesSourceFile: ts.SourceFile
  readonly implementationSourceFile: ts.SourceFile
  readonly typesChecker: ts.TypeChecker
  readonly implementationChecker: ts.TypeChecker
}

export const moduleSourcesOf: {
  (files: readonly [string, string]): (self: CompiledPackage) => Effect.Effect<BoundModuleSources | undefined>
  (self: CompiledPackage, files: readonly [string, string]): Effect.Effect<BoundModuleSources | undefined>
} = dual(
  2,
  (self: CompiledPackage, files: readonly [string, string]): Effect.Effect<BoundModuleSources | undefined> =>
    boundModuleSourcesOf(self, files),
)

const boundModuleSourcesOf = (
  self: CompiledPackage,
  files: readonly [string, string],
): Effect.Effect<BoundModuleSources | undefined> =>
  Effect.flatMap(primedTypesProgram(self, files[0]), (program) => sourcesOf(self, program, files))

const sourcesOf = (
  self: CompiledPackage,
  program: ts.Program,
  files: readonly [string, string],
): Effect.Effect<BoundModuleSources | undefined> =>
  Effect.map(
    primedTypesProgram(self, files[1]),
    (checkerProgram) => combinedSources(program, checkerProgram, presentSources(self, program, files)),
  )

const presentSources = (
  self: CompiledPackage,
  program: ts.Program,
  files: readonly [string, string],
): PresentSources | undefined =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.fromNullishOr(program.getSourceFile(files[0])),
      (typesSourceFile) =>
        Option.map(
          Option.fromNullishOr(boundImplementationFile(self, files[1])),
          (implementationSourceFile) => ({ typesSourceFile, implementationSourceFile }),
        ),
    ),
  )

interface PresentSources {
  readonly typesSourceFile: ts.SourceFile
  readonly implementationSourceFile: ts.SourceFile
}

const combinedSources = (
  program: ts.Program,
  checkerProgram: ts.Program,
  present: PresentSources | undefined,
): BoundModuleSources | undefined =>
  Option.getOrUndefined(
    Option.map(Option.fromNullishOr(present), (sources) => ({
      typesSourceFile: sources.typesSourceFile,
      implementationSourceFile: sources.implementationSourceFile,
      typesChecker: program.getTypeChecker(),
      implementationChecker: checkerProgram.getTypeChecker(),
    })),
  )

const bindOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  allowJs: true,
  checkJs: true,
}

const boundImplementationFile = (self: CompiledPackage, fileName: string): ts.SourceFile | undefined => {
  const sourceFile = hostOf(self, 'node16').getSourceFile(fileName)
  if (sourceFile === undefined) {
    return undefined
  }
  ts.bindSourceFile(sourceFile, bindOptions)
  return sourceFile
}

export const boundSourceOf: {
  (fileName: string): (self: CompiledPackage) => ts.SourceFile | undefined
  (self: CompiledPackage, fileName: string): ts.SourceFile | undefined
} = dual(
  2,
  (self: CompiledPackage, fileName: string): ts.SourceFile | undefined => boundInspectionSource(self, fileName),
)

const boundInspectionSource = (self: CompiledPackage, fileName: string): ts.SourceFile | undefined => {
  const sourceFile = inspectionHost(self, fileName).getSourceFile(fileName)
  if (sourceFile === undefined) {
    return undefined
  }
  ts.bindSourceFile(sourceFile, bindOptions)
  return sourceFile
}

const isWildcardEntrypoint = (entrypoint: string): boolean => entrypoint.includes('*')

const resolveNamedEntrypoint = (self: CompiledPackage, query: EntrypointQuery): ResolvedModulePair => {
  const host = hostOf(self, resolutionOptionOf(query.resolutionKind))
  return {
    isWildcard: false,
    types: resolveModuleView(host, self, query, false),
    implementation: resolveModuleView(host, self, query, true),
  }
}
const resolveModuleView = (
  host: CompilerHost,
  self: CompiledPackage,
  query: EntrypointQuery,
  noDtsResolution: boolean,
): ResolvedModuleView | undefined => {
  const { resolution, trace } = host.resolveModuleName(
    moduleSpecifierOf(self, query),
    importingFileNameFor(query.resolutionKind),
    resolutionModeFor(query.resolutionKind),
    noDtsResolution,
  )
  return moduleViewOf(resolution.resolvedModule, trace)
}

const moduleSpecifierOf = (self: CompiledPackage, query: EntrypointQuery): string =>
  `${self.packageName}${query.entrypoint.substring(1)}`

const moduleViewOf = (
  resolvedModule: ts.ResolvedModuleFull | undefined,
  trace: readonly string[],
): ResolvedModuleView | undefined =>
  Option.match(definedResolutionOf(resolvedModule), {
    onNone: () => undefined,
    onSome: (resolved) => moduleViewOfPair(resolved.resolvedFileName, resolved.extension, trace),
  })

const definedResolutionOf = (resolvedModule: ts.ResolvedModuleFull | undefined): Option.Option<ts.ResolvedModuleFull> =>
  Option.filter(Option.fromNullishOr(resolvedModule), (resolved) => isNonEmptyText(resolved.resolvedFileName))

const isNonEmptyText = (value: string | undefined): value is string => value !== undefined && value !== ''

const moduleViewOfPair = (
  fileName: string,
  extension: string | undefined,
  trace: readonly string[],
): ResolvedModuleView => ({
  fileName,
  isTypeScript: ts.hasTSFileExtension(fileName),
  isJson: extension === ts.Extension.Json,
  trace,
})

const importingFileNameFor = (resolutionKind: ResolutionKind): string =>
  resolutionKind === 'node16-esm' ? '/index.mts' : '/index.ts'

const resolutionModeFor = (
  resolutionKind: ResolutionKind,
): ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined => {
  if (resolutionKind === 'node16-esm') {
    return ts.ModuleKind.ESNext
  }
  return commonJsResolutionModeFor(resolutionKind)
}

const commonJsResolutionModeFor = (
  resolutionKind: ResolutionKind,
): ts.ModuleKind.CommonJS | undefined => (resolutionKind === 'node16-cjs' ? ts.ModuleKind.CommonJS : undefined)
