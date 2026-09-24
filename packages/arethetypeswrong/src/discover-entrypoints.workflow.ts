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

export class EntrypointsNotDeclared extends S.TaggedClass<EntrypointsNotDeclared>()('EntrypointsNotDeclared', {}) {
  readonly [DiscoverEntrypointsDecisionTypeId] = DiscoverEntrypointsDecisionTypeId
}

export const DiscoverEntrypointsDecision = S.Union([EntrypointsDiscovered, EntrypointsNotDeclared])
export type DiscoverEntrypointsDecision = typeof DiscoverEntrypointsDecision.Type

export class DiscoverEntrypoints extends S.Class<DiscoverEntrypoints>('DiscoverEntrypoints')({
  packageName: S.NonEmptyString,
  manifest: PackageManifest,
  entrypoints: S.Array(S.String).pipe(S.NullOr),
  include: S.Array(S.String),
  exclude: S.Array(S.String),
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
    Match.when(undefined, () => new EntrypointsNotDeclared()),
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
