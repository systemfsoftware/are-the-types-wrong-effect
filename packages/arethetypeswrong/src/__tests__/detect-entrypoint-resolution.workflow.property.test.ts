import { it } from '@effect/vitest'
import { Equal, Result } from 'effect'
import * as Match from 'effect/Match'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  detectEntrypointResolution,
  DetectEntrypointResolutionCommand,
} from '../detect-entrypoint-resolution.workflow.js'
import { type ResolutionObservation, type ResolvedModule } from '../Observation.schema.js'
import { type ModuleKind } from '../Problem.schema.js'

interface PlainProblem {
  readonly kind: string
  readonly entrypoint: string
  readonly resolutionKind: string
}

const observedProblems = (observation: ResolutionObservation): ReadonlyArray<PlainProblem> =>
  Result.match(detectEntrypointResolution(new DetectEntrypointResolutionCommand({ observation })), {
    onFailure: (): ReadonlyArray<PlainProblem> => [],
    onSuccess: (problems) =>
      problems.map((problem) =>
        Match.value(problem).pipe(
          Match.tag('NoResolutionFound', ({ entrypoint, resolutionKind }): PlainProblem => ({
            kind: 'NoResolutionFound',
            entrypoint,
            resolutionKind,
          })),
          Match.tag('UntypedResolutionFound', ({ entrypoint, resolutionKind }): PlainProblem => ({
            kind: 'UntypedResolutionFound',
            entrypoint,
            resolutionKind,
          })),
          Match.tag('CjsResolvesToEsmFound', ({ entrypoint, resolutionKind }): PlainProblem => ({
            kind: 'CjsResolvesToEsmFound',
            entrypoint,
            resolutionKind,
          })),
          Match.exhaustive,
        )
      ),
  })

const observation = (overrides: Partial<ResolutionObservation>): ResolutionObservation => ({
  entrypoint: '.',
  resolutionKind: 'node10',
  isWildcard: false,
  typesResolution: null,
  implementationResolution: null,
  node16ModuleKind: null,
  ...overrides,
})

const moduleKind = (detectedKind: 1 | 99): ModuleKind => ({
  detectedKind,
  detectedReason: 'extension',
  reasonFileName: 'index.js',
})

const typedModule: ResolvedModule = { fileName: 'index.d.ts', isTypeScript: true, isJson: false }
const untypedModule: ResolvedModule = { fileName: 'index.js', isTypeScript: false, isJson: false }

const noProblem: readonly PlainProblem[] = []
const untypedProblem: PlainProblem = {
  kind: 'UntypedResolutionFound',
  entrypoint: '.',
  resolutionKind: 'node16-cjs',
}

const INTENDED_VERDICTS: ReadonlyArray<readonly [ResolutionObservation, ReadonlyArray<PlainProblem>]> = [
  [observation({ isWildcard: true }), noProblem],
  [observation({ typesResolution: null }), [
    { kind: 'NoResolutionFound', entrypoint: '.', resolutionKind: 'node10' },
  ]],
  [observation({ typesResolution: typedModule, resolutionKind: 'node10' }), noProblem],
  [observation({ typesResolution: untypedModule, resolutionKind: 'node16-esm' }), [
    { kind: 'UntypedResolutionFound', entrypoint: '.', resolutionKind: 'node16-esm' },
  ]],
  [
    observation({
      typesResolution: untypedModule,
      resolutionKind: 'node16-cjs',
      node16ModuleKind: moduleKind(99),
    }),
    [untypedProblem, { kind: 'CjsResolvesToEsmFound', entrypoint: '.', resolutionKind: 'node16-cjs' }],
  ],
  [
    observation({
      typesResolution: typedModule,
      resolutionKind: 'node16-cjs',
      node16ModuleKind: moduleKind(99),
    }),
    [{ kind: 'CjsResolvesToEsmFound', entrypoint: '.', resolutionKind: 'node16-cjs' }],
  ],
  [
    observation({
      typesResolution: typedModule,
      resolutionKind: 'node16-cjs',
      node16ModuleKind: moduleKind(1),
    }),
    noProblem,
  ],
  [
    observation({
      typesResolution: untypedModule,
      resolutionKind: 'node16-cjs',
      node16ModuleKind: null,
    }),
    [untypedProblem],
  ],
  [
    observation({
      typesResolution: { fileName: 'data.json', isTypeScript: false, isJson: true },
      resolutionKind: 'bundler',
    }),
    noProblem,
  ],
]

const allIntendedVerdicts: Arbitrary.Arbitrary<typeof INTENDED_VERDICTS> = Arbitrary.Constant(INTENDED_VERDICTS)

it.prop(
  '∀observation_EntrypointResolution_≡IntendedVerdictTable',
  [allIntendedVerdicts],
  ([rows]) => rows.every(([candidate, intended]) => Equal.equals(observedProblems(candidate), intended)),
)

const referenceProblems = (observation: ResolutionObservation): ReadonlyArray<PlainProblem> => {
  if (observation.isWildcard) {
    return []
  }
  const problems: PlainProblem[] = []
  const resolution = observation.typesResolution
  if (resolution === null) {
    problems.push({
      kind: 'NoResolutionFound',
      entrypoint: observation.entrypoint,
      resolutionKind: observation.resolutionKind,
    })
  } else if (!resolution.isTypeScript && !resolution.isJson) {
    problems.push({
      kind: 'UntypedResolutionFound',
      entrypoint: observation.entrypoint,
      resolutionKind: observation.resolutionKind,
    })
  }
  const requiresEsm = observation.resolutionKind === 'node16-cjs'
  const resolvedToEsm = observation.node16ModuleKind !== null &&
    observation.node16ModuleKind.detectedKind === 99
  if (requiresEsm && resolvedToEsm) {
    problems.push({
      kind: 'CjsResolvesToEsmFound',
      entrypoint: observation.entrypoint,
      resolutionKind: observation.resolutionKind,
    })
  }
  return problems
}

it.prop(
  '∀observation_EntrypointResolution_≡Reference',
  [DetectEntrypointResolutionCommand],
  ([command]) => Equal.equals(observedProblems(command.observation), referenceProblems(command.observation)),
)

const withIgnoredFields = (observation: ResolutionObservation): ResolutionObservation => ({
  ...observation,
  implementationResolution: { fileName: 'implementation.js', isTypeScript: true, isJson: false },
  typesResolution: observation.typesResolution === null
    ? null
    : { ...observation.typesResolution, fileName: 'renamed.d.ts' },
})

it.prop(
  '∀observation_EntrypointResolution_ignoresUnreadFields',
  [DetectEntrypointResolutionCommand],
  ([command]) =>
    Equal.equals(
      observedProblems(command.observation),
      observedProblems(withIgnoredFields(command.observation)),
    ),
)
