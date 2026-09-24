import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Match } from 'effect'
import { valid, validRange } from 'semver'
import validatePackageName from 'validate-npm-package-name'

import { ParsePackageSpecCommand } from './parse-package-spec.workflow.js'

type PackageSpecCommand = (typeof ParsePackageSpecCommand)['Encoded']

const scopeShapeOf = (target: string): PackageSpecCommand['scopeShape'] =>
  Match.value(target.startsWith('@')).pipe(
    Match.when(false, () => 'unscoped' as const),
    Match.when(true, () =>
      Match.value(target.indexOf('/') > 1).pipe(
        Match.when(true, () => 'scoped' as const),
        Match.when(false, () => 'malformed' as const),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const separatorSearchStart = (target: string): number =>
  Match.value(scopeShapeOf(target)).pipe(
    Match.when('scoped', () => target.indexOf('/', 1) + 1),
    Match.orElse(() => 0),
  )

const nameOf = (target: string): string => {
  const start = separatorSearchStart(target)
  const at = target.indexOf('@', start)
  return Match.value(at).pipe(
    Match.when(-1, () => target),
    Match.orElse((separator) => target.slice(0, separator)),
  )
}

const versionOf = (target: string): string => {
  const start = separatorSearchStart(target)
  const at = target.indexOf('@', start)
  return Match.value(at).pipe(
    Match.when(-1, () => ''),
    Match.orElse((separator) => target.slice(separator + 1)),
  )
}

const versionShapeOf = (version: string): PackageSpecCommand['versionShape'] =>
  Match.value(version).pipe(
    Match.when('', () => 'none' as const),
    Match.orElse(() =>
      Match.value(valid(version) !== null).pipe(
        Match.when(true, () => 'exact' as const),
        Match.when(false, () =>
          Match.value(validRange(version) !== null).pipe(
            Match.when(true, () => 'range' as const),
            Match.when(false, () => 'tag' as const),
            Match.exhaustive,
          )),
        Match.exhaustive,
      )
    ),
  )

export const verdictFor = (target: string): PackageSpecCommand => {
  const wellFormed = target.isWellFormed()
  return {
    _tag: 'ParsePackageSpecCommand',
    target,
    wellFormed,
    scopeShape: scopeShapeOf(target),
    nameErrors: Match.value(wellFormed).pipe(
      Match.when(true, () => validatePackageName(nameOf(target)).errors ?? []),
      Match.when(false, () => []),
      Match.exhaustive,
    ),
    versionShape: versionShapeOf(versionOf(target)),
  }
}

export const parsePackageSpecCell = Sandwich.named('acquire.parse_package_spec')((target: string) =>
  Effect.succeed(verdictFor(target))
)
