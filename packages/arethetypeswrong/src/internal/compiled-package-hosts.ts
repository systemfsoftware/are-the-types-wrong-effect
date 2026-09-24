import './typescript-internals.js'
import type { Package } from '@systemfsoftware/npm-package'
import { Effect, Match, MutableHashMap, Option } from 'effect'
import ts from 'typescript'
import { CompilerFailed } from '../AnalysisError.schema.js'
import type { ModuleKind, ModuleKindReason } from '../Problem.schema.js'
import minimalLibDts from './minimal-lib-dts.js'

/** @internal */
export interface ResolveModuleNameResult {
  readonly resolution: ts.ResolvedModuleWithFailedLookupLocations
  readonly trace: readonly string[]
}

/** @internal */
export interface CompilerHost {
  readonly getCompilerOptions: () => ts.CompilerOptions
  readonly getSourceFile: (fileName: string) => ts.SourceFile | undefined
  readonly getSourceFileFromCache: (fileName: string) => ts.SourceFile | undefined
  readonly getModuleKindForFile: (fileName: string) => ModuleKind | undefined
  readonly resolveModuleName: (
    moduleName: string,
    containingFile: string,
    resolutionMode?: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS,
    noDtsResolution?: boolean,
    allowJs?: boolean,
  ) => ResolveModuleNameResult
  readonly getTrace: (
    fromFileName: string,
    moduleSpecifier: string,
    resolutionMode: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined,
  ) => readonly string[] | undefined
  readonly resolveSpecifier: (
    fromFileName: string,
    moduleSpecifier: string,
    resolutionMode: ts.ResolutionMode,
  ) => ts.ResolvedModuleWithFailedLookupLocations
  readonly getResolvedModule: (
    sourceFile: ts.SourceFile,
    moduleName: string,
    resolutionMode: ts.ResolutionMode,
  ) => ts.ResolvedModuleWithFailedLookupLocations | undefined
  readonly createPrimaryProgram: (rootName: string) => Effect.Effect<ts.Program>
  readonly createAuxiliaryProgram: (rootNames: readonly string[]) => Effect.Effect<ts.Program>
}

/** @internal */
export interface CompilerHosts {
  readonly node10: CompilerHost
  readonly node16: CompilerHost
  readonly bundler: CompilerHost
  readonly findHostForFiles: (files: readonly string[]) => CompilerHost | undefined
}

type ResolutionMode = ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS

interface TraceBuffer {
  readonly lines: string[]
}

interface HostState {
  readonly pkg: Package
  readonly compilerOptions: ts.CompilerOptions
  readonly normalCache: ts.ModuleResolutionCache
  readonly noDtsCache: ts.ModuleResolutionCache
  readonly resolutions: MutableHashMap.MutableHashMap<string, ResolveModuleNameResult>
  readonly sourceFiles: MutableHashMap.MutableHashMap<ts.Path, ts.SourceFile>
  readonly programs: MutableHashMap.MutableHashMap<string, ts.Program>
  readonly traces: TraceBuffer
  host: ts.CompilerHost | undefined
}

const defaultLibPath = '/node_modules/typescript/lib/lib.d.ts'
const keySeparator = '\u0000'

const canonicalFileName = ts.createGetCanonicalFileName(false)
const toPath = (fileName: string): ts.Path => ts.toPath(fileName, '/', canonicalFileName)

const moduleExtensions: readonly string[] = [
  ts.Extension.Cjs,
  ts.Extension.Cts,
  ts.Extension.Dcts,
  ts.Extension.Mjs,
  ts.Extension.Mts,
  ts.Extension.Dmts,
]

/** @internal */
export const createCompilerHosts = (pkg: Package): Effect.Effect<CompilerHosts, CompilerFailed> =>
  Effect.try({
    try: () => buildCompilerHosts(pkg),
    catch: (cause) => new CompilerFailed({ cause }),
  })

const buildCompilerHosts = (pkg: Package): CompilerHosts => {
  const node10 = makeCompilerHost(pkg, ts.ModuleResolutionKind.Node10, ts.ModuleKind.CommonJS)
  const node16 = makeCompilerHost(pkg, ts.ModuleResolutionKind.Node16, ts.ModuleKind.Node16)
  const bundler = makeCompilerHost(pkg, ts.ModuleResolutionKind.Bundler, ts.ModuleKind.ESNext)
  return {
    node10,
    node16,
    bundler,
    findHostForFiles: (files) =>
      [node10, node16, bundler].find((host) => files.every((file) => host.getSourceFileFromCache(file) !== undefined)),
  }
}

const isNonEmptyString = (value: string | undefined): value is string => value !== undefined && value !== ''

const makeState = (pkg: Package, moduleResolution: ts.ModuleResolutionKind, moduleKind: ts.ModuleKind): HostState => {
  const compilerOptions: ts.CompilerOptions = {
    moduleResolution,
    module: moduleKind,
    moduleDetection: ts.ModuleDetectionKind.Legacy,
    target: ts.ScriptTarget.Latest,
    resolveJsonModule: true,
    traceResolution: true,
  }
  return {
    pkg,
    compilerOptions,
    normalCache: ts.createModuleResolutionCache('/', canonicalFileName, compilerOptions),
    noDtsCache: ts.createModuleResolutionCache('/', canonicalFileName, compilerOptions),
    resolutions: MutableHashMap.empty(),
    sourceFiles: MutableHashMap.empty(),
    programs: MutableHashMap.empty(),
    traces: { lines: [] },
    host: undefined,
  }
}

const makeCompilerHost = (
  pkg: Package,
  moduleResolution: ts.ModuleResolutionKind,
  moduleKind: ts.ModuleKind,
): CompilerHost => {
  const state = makeState(pkg, moduleResolution, moduleKind)
  return finishCompilerHost(state)
}

const resolutionModeToModuleKind = (
  resolutionMode: ts.ResolutionMode,
): ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined =>
  Match.value(resolutionMode).pipe(
    Match.when(ts.ModuleKind.ESNext, () => ts.ModuleKind.ESNext as const),
    Match.when(ts.ModuleKind.CommonJS, () => ts.ModuleKind.CommonJS as const),
    Match.orElse(() => undefined),
  )

const finishCompilerHost = (state: HostState): CompilerHost => {
  const options = state.compilerOptions
  state.host = createCompilerHostObject(state)
  return {
    getCompilerOptions: () => options,
    getSourceFile: (fileName) => getSourceFile(state, fileName),
    getSourceFileFromCache: (fileName) => getSourceFileFromCache(state, fileName),
    getModuleKindForFile: (fileName) => getModuleKindForFile(state, fileName),
    resolveModuleName: (moduleName, containingFile, resolutionMode, noDtsResolution, allowJs) =>
      resolveModuleName(state, moduleName, containingFile, resolutionMode, noDtsResolution, allowJs),
    getTrace: (fromFileName, moduleSpecifier, resolutionMode) =>
      getTrace(state, fromFileName, moduleSpecifier, resolutionMode),
    getResolvedModule: (sourceFile, moduleName, resolutionMode) =>
      getResolvedModule(state, sourceFile, moduleName, resolutionMode),
    resolveSpecifier: (fromFileName, moduleSpecifier, resolutionMode) =>
      resolveModuleName(state, moduleSpecifier, fromFileName, resolutionModeToModuleKind(resolutionMode), undefined)
        .resolution,
    createPrimaryProgram: (rootName) => Effect.sync(() => getProgram(state, [rootName])),
    createAuxiliaryProgram: (rootNames) => Effect.sync(() => getProgram(state, rootNames)),
  }
}

const createCompilerHostObject = (state: HostState): ts.CompilerHost => ({
  fileExists: (fileName) => state.pkg.fileExists(fileName),
  readFile: (fileName) => state.pkg.readFile(fileName),
  directoryExists: (directoryName) => state.pkg.directoryExists(directoryName),
  getSourceFile: (fileName) => getSourceFile(state, fileName),
  getDefaultLibFileName: () => defaultLibPath,
  getCurrentDirectory: () => '/',
  writeFile: () => {
    throw new Error('The in-memory compiler host never writes files')
  },
  getCanonicalFileName: canonicalFileName,
  useCaseSensitiveFileNames: () => false,
  getNewLine: () => '\n',
  trace: (message) => {
    recordTraceLine(state, message)
  },
  resolveModuleNameLiterals: (moduleLiterals, containingFile, _redirectedReference, options, containingSourceFile) =>
    moduleLiterals.map((literal) =>
      literalResolution(state, literal, containingFile, options, containingSourceFile).resolution
    ),
})

const literalResolution = (
  state: HostState,
  literal: ts.StringLiteralLike,
  containingFile: string,
  options: ts.CompilerOptions,
  containingSourceFile: ts.SourceFile,
): ResolveModuleNameResult => {
  const resolutionMode = ts.getModeForUsageLocation(containingSourceFile, literal, state.compilerOptions)
  return resolveModuleName(state, literal.text, containingFile, resolutionMode, options.noDtsResolution)
}

const recordTraceLine = (state: HostState, message: string): void => {
  state.traces.lines.push(message)
}

const takeTraces = (state: HostState): readonly string[] => {
  const recorded = state.traces.lines.slice()
  state.traces.lines.length = 0
  return recorded
}

const clearTraces = (state: HostState): void => {
  state.traces.lines.length = 0
}

const flagOf = (value: boolean | undefined): number => (value === true ? 1 : 0)

const modeCode = (mode: ResolutionMode | undefined): number => (mode === undefined ? 1 : mode)

const moduleKey = (
  moduleSpecifier: string,
  resolutionMode: ResolutionMode | undefined,
  noDtsResolution: boolean | undefined,
  allowJs: boolean | undefined,
): string => [modeCode(resolutionMode), flagOf(noDtsResolution), flagOf(allowJs), moduleSpecifier].join(':')

const recordKey = (containingFile: string, moduleKeyText: string): string =>
  `${containingFile}${keySeparator}${moduleKeyText}`

const noDtsOptions = (
  compilerOptions: ts.CompilerOptions,
  allowJs: boolean | undefined,
): { readonly options: ts.CompilerOptions } =>
  Option.match(Option.fromNullishOr(allowJs), {
    onNone: () => ({ options: { ...compilerOptions, noDtsResolution: true } }),
    onSome: (value) => ({ options: { ...compilerOptions, noDtsResolution: true, allowJs: value } }),
  })

const resolutionContext = (
  state: HostState,
  noDtsResolution: boolean | undefined,
  allowJs: boolean | undefined,
): { readonly options: ts.CompilerOptions; readonly cache: ts.ModuleResolutionCache } =>
  Match.value(noDtsResolution === true).pipe(
    Match.when(true, (): { readonly options: ts.CompilerOptions; readonly cache: ts.ModuleResolutionCache } => ({
      ...noDtsOptions(state.compilerOptions, allowJs),
      cache: state.noDtsCache,
    })),
    Match.when(false, () => ({ options: state.compilerOptions, cache: state.normalCache })),
    Match.exhaustive,
  )

const resolveModuleName = (
  state: HostState,
  moduleName: string,
  containingFile: string,
  resolutionMode: ResolutionMode | undefined,
  noDtsResolution: boolean | undefined,
  allowJs?: boolean,
): ResolveModuleNameResult => {
  const keyText = moduleKey(moduleName, resolutionMode, noDtsResolution, allowJs)
  return Option.match(MutableHashMap.get(state.resolutions, recordKey(containingFile, keyText)), {
    onSome: (recorded) => recorded,
    onNone: () =>
      resolveAndRecord(state, moduleName, containingFile, resolutionMode, noDtsResolution, allowJs, keyText),
  })
}

const resolveAndRecord = (
  state: HostState,
  moduleName: string,
  containingFile: string,
  resolutionMode: ResolutionMode | undefined,
  noDtsResolution: boolean | undefined,
  allowJs: boolean | undefined,
  keyText: string,
): ResolveModuleNameResult => {
  clearTraces(state)
  const { options, cache } = resolutionContext(state, noDtsResolution, allowJs)
  const resolution = ts.resolveModuleName(
    moduleName,
    containingFile,
    options,
    hostOf(state),
    cache,
    undefined,
    resolutionMode,
  )
  const trace = takeTraces(state)
  const result: ResolveModuleNameResult = { resolution, trace }
  recordResolution(state, containingFile, keyText, result)
  return result
}

const recordResolution = (
  state: HostState,
  containingFile: string,
  keyText: string,
  result: ResolveModuleNameResult,
): void => {
  if (Option.isNone(MutableHashMap.get(state.resolutions, recordKey(containingFile, keyText)))) {
    MutableHashMap.set(state.resolutions, recordKey(containingFile, keyText), result)
  }
}

const hostOf = (state: HostState): ts.CompilerHost => {
  const host = state.host
  if (host === undefined) {
    throw new Error('The compiler host was used before it finished constructing')
  }
  return host
}

const sourceFileContent = (state: HostState, fileName: string): string | undefined => {
  if (fileName === defaultLibPath) {
    return minimalLibDts
  }
  return state.pkg.tryReadFile(fileName)
}

const getSourceFile = (state: HostState, fileName: string): ts.SourceFile | undefined => {
  const path = toPath(fileName)
  return Option.match(MutableHashMap.get(state.sourceFiles, path), {
    onSome: (cached) => cached,
    onNone: () => loadSourceFile(state, path, fileName),
  })
}

const loadSourceFile = (
  state: HostState,
  path: ts.Path,
  fileName: string,
): ts.SourceFile | undefined =>
  Option.match(Option.fromNullishOr(sourceFileContent(state, fileName)), {
    onNone: () => undefined,
    onSome: (content) => cacheSourceFile(state, path, fileName, content),
  })

const cacheSourceFile = (state: HostState, path: ts.Path, fileName: string, content: string): ts.SourceFile => {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    {
      languageVersion: ts.ScriptTarget.Latest,
      impliedNodeFormat: impliedNodeFormat(state, fileName),
    },
    true,
  )
  MutableHashMap.set(state.sourceFiles, path, sourceFile)
  return sourceFile
}

const getSourceFileFromCache = (state: HostState, fileName: string): ts.SourceFile | undefined =>
  Option.getOrUndefined(MutableHashMap.get(state.sourceFiles, toPath(fileName)))

const impliedNodeFormat = (state: HostState, fileName: string): ResolutionMode | undefined =>
  ts.getImpliedNodeFormatForFile(
    toPath(fileName),
    state.normalCache.getPackageJsonInfoCache(),
    hostOf(state),
    state.compilerOptions,
  )

const packageScopeForPath = (state: HostState, fileName: string): ts.PackageJsonInfo | undefined =>
  ts.getPackageScopeForPath(
    fileName,
    ts.getTemporaryModuleResolutionState(
      state.normalCache.getPackageJsonInfoCache(),
      hostOf(state),
      state.compilerOptions,
    ),
  )

const moduleKindSyntaxOf = (kind: ResolutionMode): 1 | 99 => (kind === ts.ModuleKind.ESNext ? 99 : 1)

const packageJsonTypeOf = (info: ts.PackageJsonInfo | undefined): string | undefined =>
  info?.contents.packageJsonContent.type

const packageJsonReasonOf = (type: string | undefined): ModuleKindReason => isNonEmptyString(type) ? 'type' : 'no:type'

const detectedReasonOf = (isExtension: boolean, type: string | undefined): ModuleKindReason =>
  isExtension ? 'extension' : packageJsonReasonOf(type)

const packageScopeOf = (
  state: HostState,
  fileName: string,
  isExtension: boolean,
): ts.PackageJsonInfo | undefined => (isExtension ? undefined : packageScopeForPath(state, fileName))

const packageJsonFileNameOf = (info: ts.PackageJsonInfo | undefined, fallback: string): string =>
  info === undefined ? fallback : `${info.packageDirectory}/package.json`

const reasonFileNameOf = (isExtension: boolean, info: ts.PackageJsonInfo | undefined, fileName: string): string =>
  isExtension ? fileName : packageJsonFileNameOf(info, fileName)

const detectedModuleKindOf = (
  state: HostState,
  fileName: string,
  kind: ResolutionMode,
): ModuleKind => {
  const isExtension = moduleExtensions.includes(ts.getAnyExtensionFromPath(fileName))
  const info = packageScopeOf(state, fileName, isExtension)
  return {
    detectedKind: moduleKindSyntaxOf(kind),
    detectedReason: detectedReasonOf(isExtension, packageJsonTypeOf(info)),
    reasonFileName: reasonFileNameOf(isExtension, info, fileName),
  }
}

const getModuleKindForFile = (state: HostState, fileName: string): ModuleKind | undefined =>
  Option.match(Option.fromNullishOr(impliedNodeFormat(state, fileName)), {
    onNone: () => undefined,
    onSome: (kind) => detectedModuleKindOf(state, fileName, kind),
  })

const getTrace = (
  state: HostState,
  fromFileName: string,
  moduleSpecifier: string,
  resolutionMode: ResolutionMode | undefined,
): readonly string[] | undefined =>
  Option.getOrUndefined(
    Option.map(
      MutableHashMap.get(
        state.resolutions,
        recordKey(fromFileName, moduleKey(moduleSpecifier, resolutionMode, undefined, undefined)),
      ),
      (recorded) => [...recorded.trace],
    ),
  )

const getResolvedModule = (
  state: HostState,
  sourceFile: ts.SourceFile,
  moduleName: string,
  resolutionMode: ts.ResolutionMode,
): ts.ResolvedModuleWithFailedLookupLocations | undefined =>
  Option.getOrUndefined(
    Option.map(
      MutableHashMap.get(
        state.resolutions,
        recordKey(sourceFile.fileName, moduleKey(moduleName, resolutionMode, undefined, undefined)),
      ),
      (recorded) => recorded.resolution,
    ),
  )

const programKey = (rootNames: readonly string[]): string => rootNames.join(keySeparator)

const createProgramFor = (state: HostState, key: string, rootNames: readonly string[]): ts.Program => {
  const program = ts.createProgram({ rootNames: [...rootNames], options: state.compilerOptions, host: hostOf(state) })
  MutableHashMap.set(state.programs, key, program)
  return program
}

const getProgram = (state: HostState, rootNames: readonly string[]): ts.Program => {
  const key = programKey(rootNames)
  return Option.match(MutableHashMap.get(state.programs, key), {
    onSome: (program) => program,
    onNone: () => createProgramFor(state, key, rootNames),
  })
}
