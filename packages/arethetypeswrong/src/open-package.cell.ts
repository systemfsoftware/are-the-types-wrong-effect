import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Package } from '@systemfsoftware/npm-package'
import { Effect, Match, Option, Result, Schema } from 'effect'
import ts from 'typescript'

import { ManifestUnreadable } from './AnalysisError.schema.js'
import {
  DiscoverEntrypoints,
  discoverEntrypoints,
  DiscoverEntrypointsDecision,
  EntrypointsNotDeclared,
  ObservedDeclaredFile,
  type ObservedPackageJson,
} from './discover-entrypoints.workflow.js'
import { PackageJsonDocument } from './internal/json-document.schema.js'
import { containsTypes } from './internal/types-presence.js'
import './internal/typescript-internals.js'
import { type PackageManifest, PackageManifestJson } from './PackageManifest.schema.js'
import type { PackageTypes, UntypedReport } from './Report.schema.js'

export type ExcludedEntrypoint = string | RegExp

export interface AnalysisRequest {
  readonly pkg: Package
  readonly companion: Package | undefined
  readonly entrypoints: ReadonlyArray<string> | undefined
  readonly includeEntrypoints: ReadonlyArray<string>
  readonly excludeEntrypoints: ReadonlyArray<ExcludedEntrypoint>
  readonly entrypointsLegacy: boolean
}

export interface PreparedPackage {
  readonly pkg: Package
  readonly packageName: string
  readonly packageVersion: string
  readonly entrypoints: ReadonlyArray<string>
  readonly types: PackageTypes
  readonly buildTools: Record<string, string>
}

const UntypedOpenedTag = { _tag: 'Untyped' } as const
type UntypedOpenedTag = typeof UntypedOpenedTag

const PreparedOpenedTag = { _tag: 'Prepared' } as const
type PreparedOpenedTag = typeof PreparedOpenedTag

interface UntypedOpened extends UntypedOpenedTag {
  readonly report: UntypedReport
}

interface PreparedOpened extends PreparedOpenedTag {
  readonly prepared: PreparedPackage
}

export type OpenedPackage = UntypedOpened | PreparedOpened

interface OpenRead {
  readonly packageName: string
  readonly manifest: PackageManifest
  readonly entrypoints: ReadonlyArray<string> | null
  readonly include: ReadonlyArray<string>
  readonly exclude: ReadonlyArray<string>
  readonly request: AnalysisRequest
  readonly companionManifest: Option.Option<PackageManifest>
  readonly legacy: boolean
  readonly declaredFiles: ReadonlyArray<ObservedDeclaredFile>
  readonly packageJsonFiles: ReadonlyArray<ObservedPackageJson>
}

type DiscoveredDecision = (typeof DiscoverEntrypointsDecision)['Encoded']

const manifestPath = (pkg: Package): string => `/node_modules/${pkg.packageName}/package.json`

const decodeManifest = (text: string): Effect.Effect<PackageManifest, ManifestUnreadable> =>
  Effect.mapError(Schema.decodeEffect(PackageManifestJson)(text), (cause) => new ManifestUnreadable({ cause }))

const readManifest = (pkg: Package): Effect.Effect<PackageManifest, ManifestUnreadable> =>
  Effect.flatMap(
    Effect.try({
      try: () => pkg.readFile(manifestPath(pkg)),
      catch: (cause) => new ManifestUnreadable({ cause }),
    }),
    decodeManifest,
  )

const companionManifestOf = (
  request: AnalysisRequest,
): Effect.Effect<Option.Option<PackageManifest>, ManifestUnreadable> =>
  Option.match(Option.fromNullishOr(request.companion), {
    onNone: () => Effect.succeedNone,
    onSome: (companion) => Effect.asSome(readManifest(companion)),
  })

const textExclusions = (exclusions: ReadonlyArray<ExcludedEntrypoint>): ReadonlyArray<string> =>
  exclusions.filter((exclusion): exclusion is string => typeof exclusion === 'string')

const regexExclusions = (exclusions: ReadonlyArray<ExcludedEntrypoint>): ReadonlyArray<RegExp> =>
  exclusions.filter((exclusion): exclusion is RegExp => exclusion instanceof RegExp)

const regexesFor = (command: OpenRead): ReadonlyArray<RegExp> =>
  command.entrypoints === null ? regexExclusions(command.request.excludeEntrypoints) : []
const explicitEntryPoints = (entrypoints: ReadonlyArray<string> | undefined): ReadonlyArray<string> | null =>
  Option.match(Option.fromNullishOr(entrypoints), {
    onNone: () => null,
    onSome: (names) => [...names],
  })
const ancestorDirectoriesOf = (path: string): ReadonlyArray<string> => {
  const directories: Array<string> = []
  ts.forEachAncestorDirectory(path, (directory) => {
    directories.push(directory)
    return undefined
  })
  return directories
}

const unparsedPackageJson = (path: string): ObservedPackageJson => ({
  path,
  name: null,
  hasMain: false,
  parsed: false,
  ancestors: ancestorDirectoriesOf(path),
})

const observedDeclaredFile = (fileName: string): ObservedDeclaredFile => ({
  fileName,
  isDeclaration: ts.isDeclarationFileName(fileName),
})

const observedName = (document: PackageJsonDocument): string | null =>
  Match.value(document['name']).pipe(
    Match.when(
      (candidate: Schema.Json): candidate is string => typeof candidate === 'string',
      (text) => text,
    ),
    Match.orElse((): string | null => null),
  )
const decodedPackageJson = (path: string, text: string): ObservedPackageJson =>
  Option.match(Schema.decodeOption(PackageJsonDocument)(text), {
    onNone: () => unparsedPackageJson(path),
    onSome: (document) => ({
      path,
      name: observedName(document),
      hasMain: 'main' in document,
      parsed: true,
      ancestors: ancestorDirectoriesOf(path),
    }),
  })

const observedPackageJson = (pkg: Package, path: string): ObservedPackageJson =>
  Option.match(Option.fromNullishOr(pkg.tryReadFile(path)), {
    onNone: () => unparsedPackageJson(path),
    onSome: (text) => decodedPackageJson(path, text),
  })

const packageRootOf = (pkg: Package): string => `/node_modules/${pkg.packageName}`

const packageJsonPaths = (pkg: Package): ReadonlyArray<string> => {
  const root = packageRootOf(pkg)
  return pkg.listFiles(root)
    .filter((file) => file.startsWith(root) && file.endsWith('/package.json'))
    .sort((left, right) => left.length - right.length)
}

const read = (request: AnalysisRequest): Effect.Effect<OpenRead, ManifestUnreadable> =>
  Effect.gen(function*() {
    const manifest = yield* readManifest(request.pkg)
    const companionManifest = yield* companionManifestOf(request)
    return {
      packageName: request.pkg.packageName,
      manifest,
      entrypoints: explicitEntryPoints(request.entrypoints),
      include: [...request.includeEntrypoints],
      exclude: textExclusions(request.excludeEntrypoints),
      request,
      companionManifest,
      legacy: request.entrypointsLegacy,
      declaredFiles: [...request.pkg.listFiles(packageRootOf(request.pkg))].map(observedDeclaredFile),
      packageJsonFiles: packageJsonPaths(request.pkg).map((path) => observedPackageJson(request.pkg, path)),
    }
  })

const subpathsOf = (decision: DiscoveredDecision): ReadonlyArray<string> =>
  Match.value(decision).pipe(
    Match.tag('EntrypointsDiscovered', (discovered) => discovered.entrypoints.map((entrypoint) => entrypoint.subpath)),
    Match.tag('ProxiesDiscovered', ({ proxies }) => [...proxies].sort(ts.comparePathsCaseInsensitive)),
    Match.tag('EntrypointsNotDeclared', () => ['.']),
    Match.exhaustive,
  )

const decisionFor = (command: OpenRead, manifest: PackageManifest): DiscoverEntrypointsDecision =>
  Result.match(discoveryResult(command, manifest), {
    onFailure: () => new EntrypointsNotDeclared(),
    onSuccess: (decision) => decision,
  })

const discoveryResult = (command: OpenRead, manifest: PackageManifest) =>
  discoverEntrypoints(discoveryCommand(command, manifest))

const companionPackageName = (command: OpenRead): string | undefined =>
  Option.match(Option.fromNullishOr(command.request.companion), {
    onNone: () => undefined,
    onSome: (companion) => companion.packageName,
  })

const packageNameOrFallback = (name: string | undefined, fallback: string): string =>
  Option.getOrElse(Option.fromNullishOr(name), () => fallback)

const discoveryCommand = (command: OpenRead, manifest: PackageManifest): DiscoverEntrypoints =>
  new DiscoverEntrypoints({
    packageName: packageNameOrFallback(companionPackageName(command), command.packageName),
    manifest,
    entrypoints: explicitEntryPoints(command.request.entrypoints),
    include: [...command.request.includeEntrypoints],
    exclude: textExclusions(command.request.excludeEntrypoints),
    legacy: command.legacy,
    declaredFiles: [...command.declaredFiles],
    packageJsonFiles: [...command.packageJsonFiles],
  })

const uniqueTexts = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  values.filter((value, index) => values.indexOf(value) === index)

const withoutRegexes = (regexes: ReadonlyArray<RegExp>, entrypoints: ReadonlyArray<string>): ReadonlyArray<string> =>
  regexes.reduce(
    (remaining, regex) => remaining.filter((entrypoint) => !regex.test(entrypoint)),
    [...entrypoints],
  )

const entrypointsFor = (command: OpenRead, subject: ReadonlyArray<string>): ReadonlyArray<string> =>
  uniqueTexts(
    [subject, companionSubpaths(command)].flatMap((candidates) => withoutRegexes(regexesFor(command), candidates)),
  )

const companionSubpaths = (command: OpenRead): ReadonlyArray<string> =>
  Option.match(command.companionManifest, {
    onNone: () => [],
    onSome: (manifest) => subpathsOf(decisionFor(command, manifest)),
  })

const buildToolsOf = (manifest: PackageManifest): Record<string, string> =>
  Option.match(Option.fromNullishOr(manifest.devDependencies), {
    onNone: () => ({}),
    onSome: (devDependencies) => selectBuildTools(devDependencies),
  })

const buildToolNames: ReadonlyArray<string> = [
  '@systemfsoftware/arethetypeswrong-cli',
  'typescript',
  'rollup',
  '@rollup/plugin-typescript',
  '@rollup/plugin-typescript2',
  'webpack',
  'esbuild',
  'parcel-bundler',
  '@preconstruct/cli',
  'vite',
  'snowpack',
  'microbundle',
  '@microsoft/api-extractor',
  'tshy',
  '@rspack/cli',
  'tsup',
  'tsdown',
]

const selectBuildTools = (devDependencies: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(devDependencies).filter(([name]) => buildToolNames.includes(name)))

interface HomepageField {
  readonly definitelyTypedUrl?: string
}

const companionFieldOf = (request: AnalysisRequest, select: (companion: Package) => string): string =>
  Option.match(Option.fromNullishOr(request.companion), {
    onNone: () => '',
    onSome: select,
  })

const homepageField = (homepage: string | undefined): HomepageField =>
  Option.match(Option.fromNullishOr(homepage), {
    onNone: () => ({}),
    onSome: (url) => ({ definitelyTypedUrl: url }),
  })

const companionTypesOf = (request: AnalysisRequest, companionManifest: PackageManifest): PackageTypes => ({
  kind: '@types',
  packageName: companionFieldOf(request, (companion) => companion.packageName),
  packageVersion: companionFieldOf(request, (companion) => companion.packageVersion),
  ...homepageField(companionManifest.homepage),
})

const typesOf = (request: AnalysisRequest, companionManifest: Option.Option<PackageManifest>): PackageTypes | false =>
  Option.match(companionManifest, {
    onSome: (manifest) => companionTypesOf(request, manifest),
    onNone: () =>
      Match.value(containsTypes(request.pkg)).pipe(
        Match.when(true, (): PackageTypes => ({ kind: 'included' })),
        Match.when(false, (): PackageTypes | false => false),
        Match.exhaustive,
      ),
  })

const untypedReportOf = (command: OpenRead): UntypedReport => ({
  packageName: command.packageName,
  packageVersion: command.request.pkg.packageVersion,
  types: false,
})

const openedOf = (command: OpenRead, entrypoints: ReadonlyArray<string>): OpenedPackage =>
  Match.value(typesOf(command.request, command.companionManifest)).pipe(
    Match.when(false, (): OpenedPackage => ({ _tag: 'Untyped', report: untypedReportOf(command) })),
    Match.orElse((types): OpenedPackage => ({
      _tag: 'Prepared',
      prepared: {
        pkg: command.request.pkg,
        packageName: command.packageName,
        packageVersion: command.request.pkg.packageVersion,
        entrypoints,
        types,
        buildTools: buildToolsOf(command.manifest),
      },
    })),
  )

const outcomeFor = (command: OpenRead, decision: DiscoveredDecision): OpenedPackage =>
  openedOf(command, entrypointsFor(command, subpathsOf(decision)))

export const openPackage: Cell.Cell<AnalysisRequest, OpenedPackage, ManifestUnreadable> = Sandwich.named(
  'open.package',
)(read)
  .decide(discoverEntrypoints)
  .write({
    EntrypointsDiscovered: (discovered, command) => Effect.succeed(outcomeFor(command, discovered)),
    ProxiesDiscovered: (proxies, command) => Effect.succeed(outcomeFor(command, proxies)),
    EntrypointsNotDeclared: (_refused, command) => Effect.succeed(outcomeFor(command, new EntrypointsNotDeclared())),
    CommandRejected: (rejected) => Effect.fail(new ManifestUnreadable({ cause: rejected })),
  })
