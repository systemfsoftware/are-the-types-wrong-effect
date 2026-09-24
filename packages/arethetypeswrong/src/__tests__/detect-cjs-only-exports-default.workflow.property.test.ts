import { it } from '@effect/vitest'
import { Equal, Result } from 'effect'
import * as Match from 'effect/Match'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  detectCjsOnlyExportsDefault,
  DetectCjsOnlyExportsDefaultCommand,
} from '../detect-cjs-only-exports-default.workflow.js'
import type { CJSOnlyExportsDefaultObservation, SourceOffset } from '../Observation.schema.js'
import { type ResolutionKind } from '../Problem.schema.js'

interface PlainProblem {
  readonly kind: string
  readonly fileName: string
  readonly pos: SourceOffset
  readonly end: SourceOffset
}

const observedProblems = (observation: CJSOnlyExportsDefaultObservation): ReadonlyArray<PlainProblem> =>
  Result.match(
    detectCjsOnlyExportsDefault(new DetectCjsOnlyExportsDefaultCommand({ observation })),
    {
      onFailure: (): ReadonlyArray<PlainProblem> => [],
      onSuccess: (problems) =>
        problems.map((problem) =>
          Match.value(problem).pipe(
            Match.tag('CjsOnlyExportsDefaultFound', ({ fileName, pos, end }): PlainProblem => ({
              kind: 'CjsOnlyExportsDefaultFound',
              fileName,
              pos,
              end,
            })),
            Match.exhaustive,
          )
        ),
    },
  )

const observation = (overrides: {
  readonly resolutionKind?: ResolutionKind
  readonly implementationFileName?: string
  readonly isCommonJsOnlyFile?: boolean
  readonly hasDefaultAndEsModuleMarkers?: boolean
  readonly hasExportEquals?: boolean
  readonly defaultDeclarationStart?: SourceOffset | null
  readonly defaultDeclarationEnd?: SourceOffset | null
}): CJSOnlyExportsDefaultObservation => ({
  resolutionKind: 'node16-esm',
  implementationFileName: 'dist/index.js',
  isCommonJsOnlyFile: true,
  hasDefaultAndEsModuleMarkers: true,
  hasExportEquals: false,
  defaultDeclarationStart: 20,
  defaultDeclarationEnd: 55,
  ...overrides,
})

const noProblem: readonly PlainProblem[] = []
const interopProblem: PlainProblem = {
  kind: 'CjsOnlyExportsDefaultFound',
  fileName: 'dist/index.js',
  pos: 20,
  end: 55,
}

const INTENDED_VERDICTS: ReadonlyArray<readonly [CJSOnlyExportsDefaultObservation, ReadonlyArray<PlainProblem>]> = [
  [observation({ resolutionKind: 'node16-esm' }), [interopProblem]],
  [observation({ resolutionKind: 'bundler' }), [interopProblem]],
  [observation({ resolutionKind: 'node10' }), noProblem],
  [observation({ resolutionKind: 'node16-cjs' }), noProblem],
  [observation({ isCommonJsOnlyFile: false }), noProblem],
  [observation({ hasDefaultAndEsModuleMarkers: false }), noProblem],
  [observation({ hasExportEquals: true }), noProblem],
  [observation({ defaultDeclarationStart: null }), noProblem],
  [observation({ defaultDeclarationEnd: null }), noProblem],
  [
    observation({ implementationFileName: 'dist/transpiled.js', defaultDeclarationStart: 0, defaultDeclarationEnd: 7 }),
    [{ kind: 'CjsOnlyExportsDefaultFound', fileName: 'dist/transpiled.js', pos: 0, end: 7 }],
  ],
]

const allIntendedVerdicts: Arbitrary.Arbitrary<typeof INTENDED_VERDICTS> = Arbitrary.Constant(INTENDED_VERDICTS)

it.prop(
  '∀observation_CjsOnlyExportsDefault_≡IntendedVerdictTable',
  [allIntendedVerdicts],
  ([rows]) => rows.every(([candidate, intended]) => Equal.equals(observedProblems(candidate), intended)),
)

const referenceProblems = (observation: CJSOnlyExportsDefaultObservation): ReadonlyArray<PlainProblem> => {
  if (observation.resolutionKind === 'node10' || observation.resolutionKind === 'node16-cjs') {
    return []
  }
  const hasInterop = observation.isCommonJsOnlyFile &&
    observation.hasDefaultAndEsModuleMarkers &&
    !observation.hasExportEquals
  if (!hasInterop) {
    return []
  }
  if (observation.defaultDeclarationStart === null || observation.defaultDeclarationEnd === null) {
    return []
  }
  return [{
    kind: 'CjsOnlyExportsDefaultFound',
    fileName: observation.implementationFileName,
    pos: observation.defaultDeclarationStart,
    end: observation.defaultDeclarationEnd,
  }]
}

it.prop(
  '∀observation_CjsOnlyExportsDefault_≡Reference',
  [DetectCjsOnlyExportsDefaultCommand],
  ([command]) => Equal.equals(observedProblems(command.observation), referenceProblems(command.observation)),
)
