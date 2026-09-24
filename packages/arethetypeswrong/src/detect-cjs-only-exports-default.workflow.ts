import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { CJSOnlyExportsDefaultObservation, type SourceOffset } from './Observation.schema.js'
import { type ResolutionKind } from './Problem.schema.js'

const CjsOnlyExportsDefaultProblemTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong/CjsOnlyExportsDefaultProblem',
)
type CjsOnlyExportsDefaultProblemTypeId = typeof CjsOnlyExportsDefaultProblemTypeId

export class CjsOnlyExportsDefaultFound extends S.TaggedClass<CjsOnlyExportsDefaultFound>()(
  'CjsOnlyExportsDefaultFound',
  {
    fileName: S.String,
    pos: S.Finite,
    end: S.Finite,
  },
) {
  readonly [CjsOnlyExportsDefaultProblemTypeId] = CjsOnlyExportsDefaultProblemTypeId
}

export const CjsOnlyExportsDefaultProblems = S.Array(CjsOnlyExportsDefaultFound)
export type CjsOnlyExportsDefaultProblems = typeof CjsOnlyExportsDefaultProblems.Type

export class DetectCjsOnlyExportsDefaultCommand extends S.Class<DetectCjsOnlyExportsDefaultCommand>(
  'DetectCjsOnlyExportsDefaultCommand',
)({ observation: CJSOnlyExportsDefaultObservation }) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

interface DeclarationRange {
  readonly pos: SourceOffset
  readonly end: SourceOffset
}

const seesThisFileThroughEsm = (resolutionKind: ResolutionKind): boolean =>
  Match.value(resolutionKind).pipe(
    Match.when('node16-esm', () => true),
    Match.when('bundler', () => true),
    Match.when('node10', () => false),
    Match.when('node16-cjs', () => false),
    Match.exhaustive,
  )

const hasInteropMarkers = (observation: CJSOnlyExportsDefaultObservation): boolean =>
  Match.value({
    commonJsOnlyFile: observation.isCommonJsOnlyFile,
    defaultAndEsModuleMarkers: observation.hasDefaultAndEsModuleMarkers,
    exportEquals: observation.hasExportEquals,
  }).pipe(
    Match.when({ commonJsOnlyFile: true, defaultAndEsModuleMarkers: true, exportEquals: false }, () => true),
    Match.orElse(() => false),
  )

const declarationRange = (observation: CJSOnlyExportsDefaultObservation): Option.Option<DeclarationRange> =>
  Option.all({
    pos: Option.fromNullishOr(observation.defaultDeclarationStart),
    end: Option.fromNullishOr(observation.defaultDeclarationEnd),
  })

const cjsOnlyExportsDefaultProblems = (observation: CJSOnlyExportsDefaultObservation): CjsOnlyExportsDefaultProblems =>
  Option.match(declarationRange(observation), {
    onSome: ({ pos, end }): CjsOnlyExportsDefaultProblems =>
      Match.value({
        esmConsumer: seesThisFileThroughEsm(observation.resolutionKind),
        interop: hasInteropMarkers(observation),
      }).pipe(
        Match.when({ esmConsumer: true, interop: true }, (): CjsOnlyExportsDefaultProblems => [
          new CjsOnlyExportsDefaultFound({ fileName: observation.implementationFileName, pos, end }),
        ]),
        Match.orElse((): CjsOnlyExportsDefaultProblems => []),
      ),
    onNone: (): CjsOnlyExportsDefaultProblems => [],
  })

export const detectCjsOnlyExportsDefault = Workflow.make({
  command: DetectCjsOnlyExportsDefaultCommand,
  decision: CjsOnlyExportsDefaultProblems,
  error: S.Never,
  decide: (command): Result.Result<CjsOnlyExportsDefaultProblems, never> =>
    Result.succeed(cjsOnlyExportsDefaultProblems(command.observation)),
})
