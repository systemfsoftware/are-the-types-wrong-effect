import { it } from '@effect/vitest'
import { Equal, Result } from 'effect'
import * as Match from 'effect/Match'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  detectInternalResolutionError,
  DetectInternalResolutionErrorCommand,
} from '../detect-internal-resolution-error.workflow.js'
import type { InternalResolutionErrorObservation } from '../Observation.schema.js'

interface PlainProblem {
  readonly kind: string
  readonly resolutionOption: string
  readonly fileName: string
  readonly moduleSpecifier: string
  readonly pos: number
  readonly end: number
  readonly resolutionMode: number | undefined
  readonly trace: ReadonlyArray<string>
}

const observedProblems = (observation: InternalResolutionErrorObservation): ReadonlyArray<PlainProblem> =>
  Result.match(
    detectInternalResolutionError(new DetectInternalResolutionErrorCommand({ observation })),
    {
      onFailure: (): ReadonlyArray<PlainProblem> => [],
      onSuccess: (problems) =>
        problems.map((problem) =>
          Match.value(problem).pipe(
            Match.tag(
              'InternalResolutionErrorFound',
              ({
                resolutionOption,
                fileName,
                moduleSpecifier,
                pos,
                end,
                resolutionMode,
                trace,
              }): PlainProblem => ({
                kind: 'InternalResolutionErrorFound',
                resolutionOption,
                fileName,
                moduleSpecifier,
                pos,
                end,
                resolutionMode,
                trace: [...trace],
              }),
            ),
            Match.exhaustive,
          )
        ),
    },
  )

const observation = (overrides: {
  readonly resolutionOption?: InternalResolutionErrorObservation['resolutionOption']
  readonly fileName?: string
  readonly moduleSpecifier?: string
  readonly pos?: number
  readonly end?: number
  readonly resolutionMode?: number | null
  readonly trace?: ReadonlyArray<string>
}): InternalResolutionErrorObservation => ({
  resolutionOption: 'node16',
  fileName: 'dist/index.js',
  moduleSpecifier: '#internal/util.js',
  pos: 12,
  end: 31,
  resolutionMode: 99,
  trace: ["Failed to resolve entry '#internal/util.js'"],
  ...overrides,
})

const placedProblem = (overrides: {
  readonly resolutionOption: string
  readonly fileName: string
  readonly moduleSpecifier: string
  readonly pos: number
  readonly end: number
  readonly resolutionMode: number | undefined
  readonly trace: ReadonlyArray<string>
}): PlainProblem => ({ kind: 'InternalResolutionErrorFound', ...overrides })

const INTENDED_VERDICTS: ReadonlyArray<readonly [InternalResolutionErrorObservation, ReadonlyArray<PlainProblem>]> = [
  [
    observation({}),
    [
      placedProblem({
        resolutionOption: 'node16',
        fileName: 'dist/index.js',
        moduleSpecifier: '#internal/util.js',
        pos: 12,
        end: 31,
        resolutionMode: 99,
        trace: ["Failed to resolve entry '#internal/util.js'"],
      }),
    ],
  ],
  [
    observation({ resolutionMode: null }),
    [
      placedProblem({
        resolutionOption: 'node16',
        fileName: 'dist/index.js',
        moduleSpecifier: '#internal/util.js',
        pos: 12,
        end: 31,
        resolutionMode: undefined,
        trace: ["Failed to resolve entry '#internal/util.js'"],
      }),
    ],
  ],
  [
    observation({ resolutionOption: 'node10', resolutionMode: 1, trace: [] }),
    [
      placedProblem({
        resolutionOption: 'node10',
        fileName: 'dist/index.js',
        moduleSpecifier: '#internal/util.js',
        pos: 12,
        end: 31,
        resolutionMode: 1,
        trace: [],
      }),
    ],
  ],
]

const allIntendedVerdicts: Arbitrary.Arbitrary<typeof INTENDED_VERDICTS> = Arbitrary.Constant(INTENDED_VERDICTS)

it.prop(
  '∀observation_InternalResolutionError_≡IntendedVerdictTable',
  [allIntendedVerdicts],
  ([rows]) => rows.every(([candidate, intended]) => Equal.equals(observedProblems(candidate), intended)),
)

const referenceProblems = (observation: InternalResolutionErrorObservation): ReadonlyArray<PlainProblem> => [
  {
    kind: 'InternalResolutionErrorFound',
    resolutionOption: observation.resolutionOption,
    fileName: observation.fileName,
    moduleSpecifier: observation.moduleSpecifier,
    pos: observation.pos,
    end: observation.end,
    resolutionMode: observation.resolutionMode === null ? undefined : observation.resolutionMode,
    trace: [...observation.trace],
  },
]

it.prop(
  '∀observation_InternalResolutionError_placesTheUnresolvedSpecifier',
  [DetectInternalResolutionErrorCommand],
  ([command]) => Equal.equals(observedProblems(command.observation), referenceProblems(command.observation)),
)
