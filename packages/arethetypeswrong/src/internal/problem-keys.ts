import { Match, Option } from 'effect'
import { dual } from 'effect/Function'

import type { ModuleKind } from '../Problem.schema.js'
import type { CellPlan, ProblemFamily } from './analysis-plan.js'

type KeyPart = string | number | boolean | undefined

const moduleKindSyntaxEsm = 99

const keyText = (part: KeyPart): string => (part === undefined ? '\u0001' : String(part))

const keyOf = (family: string, parts: ReadonlyArray<KeyPart>): string => [family, ...parts].map(keyText).join('\u0000')

const kindKey = (moduleKind: ModuleKind | undefined): string | undefined =>
  Option.match(Option.fromNullishOr(moduleKind), {
    onNone: () => undefined,
    onSome: (kind) => `${kind.detectedKind}:${kind.detectedReason}:${kind.reasonFileName}`,
  })

const resolutionName = (cell: CellPlan): string | undefined =>
  Option.match(Option.fromNullishOr(cell.resolution), {
    onNone: () => undefined,
    onSome: (resolution) => resolution.fileName,
  })

const implementationName = (cell: CellPlan): string | undefined =>
  Option.match(Option.fromNullishOr(cell.implementationResolution), {
    onNone: () => undefined,
    onSome: (resolution) => resolution.fileName,
  })

const kindAt = (cell: CellPlan, fileName: string | undefined): ModuleKind | undefined =>
  Option.match(Option.fromNullishOr(cell.moduleKinds), {
    onNone: () => undefined,
    onSome: (moduleKinds) => moduleKinds[fileName ?? ''],
  })

const usableName = (fileName: string | false | undefined): string | undefined =>
  Match.value(fileName).pipe(
    Match.when(undefined, () => undefined),
    Match.when(false, () => undefined),
    Match.when('', () => undefined),
    Match.orElse((name) => name),
  )

const typesFileNameOf = (cell: CellPlan): string | false | undefined =>
  Option.match(Option.fromNullishOr(cell.resolution), {
    onNone: () => undefined,
    onSome: (resolution) => (resolution.isTypeScript ? resolution.fileName : false),
  })

const detectsEsmAt = (cell: CellPlan, fileName: string | undefined): boolean =>
  Match.value(kindAt(cell, fileName)).pipe(
    Match.when({ detectedKind: moduleKindSyntaxEsm }, () => true),
    Match.orElse(() => false),
  )

const resolutionDetectsEsm = (cell: CellPlan): boolean =>
  detectsEsmAt(cell, resolutionName(cell)) || detectsEsmAt(cell, implementationName(cell))

/** @internal */
export const dedupeKeyOf: {
  (cell: CellPlan, family: ProblemFamily, fileName: string | undefined): string
  (family: ProblemFamily, fileName: string | undefined): (cell: CellPlan) => string
} = dual(3, (cell: CellPlan, family: ProblemFamily, fileName: string | undefined): string =>
  Match.value(family).pipe(
    Match.when('entrypointResolution', () => keyOf(family, [cell.entrypoint, cell.resolutionKind])),
    Match.when('moduleKindDisagreement', () =>
      keyOf(family, [
        resolutionName(cell),
        implementationName(cell),
        kindKey(kindAt(cell, resolutionName(cell))),
        kindKey(kindAt(cell, implementationName(cell))),
      ])),
    Match.when('exportDefaultDisagreement', () => exportDefaultKey(cell)),
    Match.when('namedExports', () =>
      keyOf(family, [
        implementationName(cell),
        kindKey(kindAt(cell, implementationName(cell))),
        typesFileNameOf(cell),
        kindKey(kindAt(cell, usableName(typesFileNameOf(cell)))),
        cell.resolutionKind,
      ])),
    Match.when('cjsOnlyExportsDefault', () => keyOf(family, [implementationName(cell), cell.resolutionKind])),
    Match.when('unexpectedModuleSyntax', () => keyOf(family, [fileName, kindKey(kindAt(cell, fileName))])),
    Match.when('internalResolutionError', () => keyOf(family, [cell.resolutionOption, fileName])),
    Match.exhaustive,
  ))

const exportDefaultKey = (cell: CellPlan): string =>
  Match.value(resolutionDetectsEsm(cell)).pipe(
    Match.when(true, () => keyOf('exportDefaultDisagreement', [])),
    Match.when(false, () => keyOf('exportDefaultDisagreement', [resolutionName(cell), implementationName(cell)])),
    Match.exhaustive,
  )
