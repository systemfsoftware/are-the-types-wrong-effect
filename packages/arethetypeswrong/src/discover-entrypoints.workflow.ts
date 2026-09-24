import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Predicate, Result } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import {
  type ManifestExportsConditions,
  type ManifestExportsTarget,
  PackageManifest,
} from './PackageManifest.schema.js'

const DiscoverEntrypointsDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong/DiscoverEntrypointsDecision',
)
type DiscoverEntrypointsDecisionTypeId = typeof DiscoverEntrypointsDecisionTypeId

export class DiscoveredEntrypoint extends S.TaggedClass<DiscoveredEntrypoint>()('DiscoveredEntrypoint', {
  subpath: S.NonEmptyString,
  isWildcard: S.Boolean,
}) {}

export class EntrypointsDiscovered extends S.TaggedClass<EntrypointsDiscovered>()('EntrypointsDiscovered', {
  entrypoints: S.Array(DiscoveredEntrypoint),
}) {
  readonly [DiscoverEntrypointsDecisionTypeId] = DiscoverEntrypointsDecisionTypeId
}

export class ProxiesDiscovered extends S.TaggedClass<ProxiesDiscovered>()('ProxiesDiscovered', {
  proxies: S.Array(S.String),
}) {
  readonly [DiscoverEntrypointsDecisionTypeId] = DiscoverEntrypointsDecisionTypeId
}

export class EntrypointsNotDeclared extends S.TaggedClass<EntrypointsNotDeclared>()('EntrypointsNotDeclared', {}) {
  readonly [DiscoverEntrypointsDecisionTypeId] = DiscoverEntrypointsDecisionTypeId
}

export const DiscoverEntrypointsDecision = S.Union([
  EntrypointsDiscovered,
  ProxiesDiscovered,
  EntrypointsNotDeclared,
])
export type DiscoverEntrypointsDecision = typeof DiscoverEntrypointsDecision.Type

export const ObservedDeclaredFile = S.Struct({
  fileName: S.String,
  isDeclaration: S.Boolean,
})
export type ObservedDeclaredFile = typeof ObservedDeclaredFile.Type

export const ObservedPackageJson = S.Struct({
  path: S.String,
  name: S.NullOr(S.String),
  hasMain: S.Boolean,
  parsed: S.Boolean,
  ancestors: S.Array(S.String),
})
export type ObservedPackageJson = typeof ObservedPackageJson.Type

export class DiscoverEntrypoints extends S.Class<DiscoverEntrypoints>('DiscoverEntrypoints')({
  packageName: S.NonEmptyString,
  manifest: PackageManifest,
  entrypoints: S.Array(S.String).pipe(S.NullOr),
  include: S.Array(S.String),
  exclude: S.Array(S.String),
  legacy: S.Boolean,
  declaredFiles: S.Array(ObservedDeclaredFile),
  packageJsonFiles: S.Array(ObservedPackageJson),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const isExportsArray = (target: ManifestExportsTarget): target is readonly ManifestExportsTarget[] =>
  Array.isArray(target)

const isExportsConditions = (target: ManifestExportsTarget): target is ManifestExportsConditions =>
  Predicate.isObject(target)

const bareTargetHasExport = (bare: string | null): boolean =>
  Match.value(bare === null).pipe(
    Match.when(true, () => false),
    Match.when(false, () => true),
    Match.exhaustive,
  )

const arrayHasExportTarget = (elements: readonly ManifestExportsTarget[]): boolean => elements.some(hasExportTarget)

const conditionsHaveExportTarget = (conditions: ManifestExportsConditions): boolean =>
  Object.keys(conditions).some((key) => hasExportTarget(conditions[key]))

const hasExportTarget = (target: ManifestExportsTarget): boolean =>
  Match.value(target).pipe(
    Match.when(isExportsArray, arrayHasExportTarget),
    Match.when(isExportsConditions, conditionsHaveExportTarget),
    Match.orElse(bareTargetHasExport),
  )

const isSubpathKeyed = (keys: readonly string[]): keys is readonly [string, ...ReadonlyArray<string>] => keys.length > 0

const subpathsOfConditions = (conditions: ManifestExportsConditions): readonly string[] => {
  const keys = Object.keys(conditions)
  return Match.value(keys).pipe(
    Match.when(isSubpathKeyed, (nonEmpty) =>
      Match.value(nonEmpty[0].startsWith('.')).pipe(
        Match.when(true, () => keys.filter((key) => hasExportTarget(conditions[key]))),
        Match.when(false, () => keys.flatMap((key) => subpathsOf(conditions[key]))),
        Match.exhaustive,
      )),
    Match.orElse(() => []),
  )
}

const subpathsOf = (target: ManifestExportsTarget): readonly string[] =>
  Match.value(target).pipe(
    Match.when(isExportsArray, (elements) => elements.flatMap(subpathsOf)),
    Match.when(isExportsConditions, subpathsOfConditions),
    Match.orElse(() => []),
  )

const detectedSubpaths = (exports: ManifestExportsTarget): readonly string[] => {
  const subpaths = subpathsOf(exports)
  return Match.value({ empty: subpaths.length === 0, hasTarget: hasExportTarget(exports) }).pipe(
    Match.when({ empty: true, hasTarget: true }, () => ['.']),
    Match.orElse(() => subpaths),
  )
}

const isRelativeSpecifier = (path: string): boolean =>
  Match.value({ selfDot: path === '.', dotSlash: path.startsWith('./') }).pipe(
    Match.when({ selfDot: true }, () => true),
    Match.when({ dotSlash: true }, () => true),
    Match.orElse(() => false),
  )

const formattedSubpath = (path: string, packageName: string): string =>
  Match.value({
    relative: isRelativeSpecifier(path),
    self: path === packageName,
    subpath: path.startsWith(`${packageName}/`),
  }).pipe(
    Match.when({ relative: true }, () => path),
    Match.when({ self: true }, () => '.'),
    Match.when({ subpath: true }, () => `.${path.slice(packageName.length)}`),
    Match.orElse(() => `./${path}`),
  )

const formattedNames = (names: readonly string[], packageName: string): readonly string[] =>
  names.map((name) => formattedSubpath(name, packageName).trim())

const uniqueNames = (names: readonly string[]): readonly string[] =>
  names.filter((name, index) => names.indexOf(name) === index)

const declaredPrefix = (packageName: string): string => `/node_modules/${packageName}`

const subpathOfDeclaredFile = (fileName: string, packageName: string): string =>
  `.${fileName.slice(declaredPrefix(packageName).length)}`

const legacyExtensions: ReadonlyArray<string> = ['.jsx', '.tsx', '.js', '.ts', '.mjs', '.cjs', '.mts']

const extensionOf = (fileName: string): string => fileName.slice(fileName.lastIndexOf('.'))

const hasLegacyExtension = (fileName: string): boolean => legacyExtensions.includes(extensionOf(fileName))

const isLegacyDeclaredFile = (declared: ObservedDeclaredFile): boolean =>
  Match.value(declared.isDeclaration).pipe(
    Match.when(true, () => false),
    Match.when(false, () => hasLegacyExtension(declared.fileName)),
    Match.exhaustive,
  )

const declaredCandidates = (command: DiscoverEntrypoints): ReadonlyArray<ObservedDeclaredFile> =>
  Match.value(command.legacy).pipe(
    Match.when(true, () => command.declaredFiles),
    Match.when(false, () => []),
    Match.exhaustive,
  )

const legacyDeclaredEntrypoints = (command: DiscoverEntrypoints): ReadonlyArray<DiscoveredEntrypoint> =>
  discoveredEntrypoints(
    declaredCandidates(command).filter(isLegacyDeclaredFile).map((declared) =>
      formattedSubpath(subpathOfDeclaredFile(declared.fileName, command.packageName), command.packageName).trim()
    ),
  )

const isUnrelatedName = (name: string | null, packageName: string): boolean =>
  Match.value(name).pipe(
    Match.when(Predicate.isString, (text) =>
      Match.value({ empty: text === '', related: text.startsWith(packageName) }).pipe(
        Match.when({ empty: false, related: false }, () =>
          true),
        Match.orElse(() => false),
      )),
    Match.orElse(() =>
      false
    ),
  )

const directoryOfRow = (row: ObservedPackageJson): string => row.path.slice(0, row.path.lastIndexOf('/'))

const isVendorRow = (row: ObservedPackageJson, packageName: string): boolean =>
  Match.value({ parsed: row.parsed, vendor: isUnrelatedName(row.name, packageName) }).pipe(
    Match.when({ parsed: true, vendor: true }, () => true),
    Match.orElse(() => false),
  )

const vendorsBefore = (
  rows: ReadonlyArray<ObservedPackageJson>,
  index: number,
  packageName: string,
): ReadonlyArray<string> => rows.slice(0, index).filter((row) => isVendorRow(row, packageName)).map(directoryOfRow)

const insideVendorDirectory = (vendors: ReadonlyArray<string>, ancestors: ReadonlyArray<string>): boolean =>
  ancestors.some((directory) => vendors.includes(directory))

const isProxyRow = (
  row: ObservedPackageJson,
  vendors: ReadonlyArray<string>,
  packageName: string,
): boolean =>
  Match.value({
    parsed: row.parsed,
    vendor: isUnrelatedName(row.name, packageName),
    main: row.hasMain,
    inside: insideVendorDirectory(vendors, row.ancestors),
  }).pipe(
    Match.when({ parsed: true, vendor: false, main: true, inside: false }, () => true),
    Match.orElse(() => false),
  )

const proxySubpathOf = (row: ObservedPackageJson, packageName: string): string =>
  `.${row.path.slice(declaredPrefix(packageName).length, row.path.lastIndexOf('/'))}`

const proxySubpaths = (command: DiscoverEntrypoints): ReadonlyArray<string> =>
  command.packageJsonFiles
    .filter((row, index, rows) => isProxyRow(row, vendorsBefore(rows, index, command.packageName), command.packageName))
    .map((row) => proxySubpathOf(row, command.packageName))

const hasNoProxies = (proxies: ReadonlyArray<string>): boolean => proxies.length === 0

const manifestLegacy = (command: DiscoverEntrypoints): DiscoverEntrypointsDecision =>
  Match.value(command.legacy).pipe(
    Match.when(true, () => new EntrypointsDiscovered({ entrypoints: legacyDeclaredEntrypoints(command) })),
    Match.when(false, () => new EntrypointsNotDeclared()),
    Match.exhaustive,
  )

const manifestProxiesOrLegacy = (command: DiscoverEntrypoints): DiscoverEntrypointsDecision =>
  Match.value(proxySubpaths(command)).pipe(
    Match.when(hasNoProxies, () => manifestLegacy(command)),
    Match.orElse((proxies) => new ProxiesDiscovered({ proxies })),
  )

const notExcluded = (entrypoint: string, exclusions: readonly string[]): boolean =>
  Match.value(exclusions.includes(entrypoint)).pipe(
    Match.when(true, () => false),
    Match.when(false, () => true),
    Match.exhaustive,
  )

const discoveredEntrypoints = (subpaths: readonly string[]): ReadonlyArray<DiscoveredEntrypoint> =>
  subpaths.map((subpath) => new DiscoveredEntrypoint({ subpath, isWildcard: subpath.includes('*') }))

const exportsEntrypoints = (
  exports: ManifestExportsTarget,
  command: DiscoverEntrypoints,
): ReadonlyArray<DiscoveredEntrypoint> => {
  const included = uniqueNames([
    ...detectedSubpaths(exports),
    ...formattedNames(command.include, command.packageName),
  ])
  const exclusions = formattedNames(command.exclude, command.packageName)
  return discoveredEntrypoints(included.filter((entrypoint) => notExcluded(entrypoint, exclusions)))
}

const manifestEntrypoints = (command: DiscoverEntrypoints): DiscoverEntrypointsDecision =>
  Match.value(command.manifest.exports).pipe(
    Match.when(undefined, () => manifestProxiesOrLegacy(command)),
    Match.orElse(
      (exports) => new EntrypointsDiscovered({ entrypoints: exportsEntrypoints(exports, command) }),
    ),
  )

const explicitOrManifest = (command: DiscoverEntrypoints): DiscoverEntrypointsDecision =>
  Option.match(Option.fromNullishOr(command.entrypoints), {
    onSome: (names): DiscoverEntrypointsDecision =>
      new EntrypointsDiscovered({
        entrypoints: discoveredEntrypoints(formattedNames(names, command.packageName)),
      }),
    onNone: () => manifestEntrypoints(command),
  })

export const discoverEntrypoints = Workflow.make({
  command: DiscoverEntrypoints,
  decision: DiscoverEntrypointsDecision,
  error: S.Never,
  decide: (command): Result.Result<DiscoverEntrypointsDecision, never> => Result.succeed(explicitOrManifest(command)),
})
