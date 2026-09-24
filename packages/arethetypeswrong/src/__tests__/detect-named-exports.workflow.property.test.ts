import { it } from '@effect/vitest'
import { Equal, Result } from 'effect'
import * as Match from 'effect/Match'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { detectNamedExports, DetectNamedExportsCommand } from '../detect-named-exports.workflow.js'
import { type NamedExportsObservation } from '../Observation.schema.js'
import { type ModuleKind } from '../Problem.schema.js'

interface PlainProblem {
  readonly kind: string
  readonly typesFileName: string
  readonly implementationFileName: string
  readonly isMissingAllNamed: boolean
  readonly missing: ReadonlyArray<string>
}

const observedProblems = (observation: NamedExportsObservation): ReadonlyArray<PlainProblem> =>
  Result.match(detectNamedExports(new DetectNamedExportsCommand({ observation })), {
    onFailure: (): ReadonlyArray<PlainProblem> => [],
    onSuccess: (problems) =>
      problems.map((problem) =>
        Match.value(problem).pipe(
          Match.tag(
            'NamedExportsFound',
            ({ typesFileName, implementationFileName, isMissingAllNamed, missing }): PlainProblem => ({
              kind: 'NamedExportsFound',
              typesFileName,
              implementationFileName,
              isMissingAllNamed,
              missing: [...missing],
            }),
          ),
          Match.exhaustive,
        )
      ),
  })

const observation = (overrides: {
  readonly resolutionKind?: NamedExportsObservation['resolutionKind']
  readonly typesFileName?: string | null
  readonly implementationFileName?: string | null
  readonly typesModuleKind?: ModuleKind | null
  readonly implementationModuleKind?: ModuleKind | null
  readonly typesIsArrayLikeModule?: boolean | null
  readonly typesValueExportNames?: ReadonlyArray<string> | null
  readonly implementationExportNames?: ReadonlyArray<string> | null
}): NamedExportsObservation => {
  const base: NamedExportsObservation = {
    resolutionKind: 'node16-esm',
    typesFileName: 'types.d.ts',
    implementationFileName: 'index.js',
    typesModuleKind: { detectedKind: 1, detectedReason: 'extension', reasonFileName: 'types.d.ts' },
    implementationModuleKind: { detectedKind: 1, detectedReason: 'extension', reasonFileName: 'index.js' },
    typesIsArrayLikeModule: false,
    typesValueExportNames: ['alpha'],
    implementationExportNames: ['alpha'],
  }
  return { ...base, ...overrides }
}

const moduleKind = (detectedKind: 1 | 99): ModuleKind => ({
  detectedKind,
  detectedReason: 'type',
  reasonFileName: 'types.d.ts',
})

const noProblem: readonly PlainProblem[] = []
const missingProblem = (missing: ReadonlyArray<string>, isMissingAllNamed: boolean): PlainProblem => ({
  kind: 'NamedExportsFound',
  typesFileName: 'types.d.ts',
  implementationFileName: 'index.js',
  isMissingAllNamed,
  missing,
})

const INTENDED_VERDICTS: ReadonlyArray<readonly [NamedExportsObservation, ReadonlyArray<PlainProblem>]> = [
  [observation({ typesValueExportNames: ['alpha', 'beta'], implementationExportNames: ['alpha'] }), [
    missingProblem(['beta'], false),
  ]],
  [observation({ typesValueExportNames: ['alpha', 'default'], implementationExportNames: ['default'] }), [
    missingProblem(['alpha'], true),
  ]],
  [observation({ typesValueExportNames: ['beta', 'alpha'], implementationExportNames: ['gamma'] }), [
    missingProblem(['beta', 'alpha'], true),
  ]],
  [observation({ typesValueExportNames: ['alpha', 'beta'], implementationExportNames: ['alpha', 'beta'] }), noProblem],
  [observation({ resolutionKind: 'node10' }), noProblem],
  [observation({ resolutionKind: 'node16-cjs' }), noProblem],
  [observation({ typesModuleKind: moduleKind(99) }), noProblem],
  [observation({ typesModuleKind: null }), noProblem],
  [observation({ implementationModuleKind: null }), noProblem],
  [observation({ typesIsArrayLikeModule: true }), noProblem],
  [observation({ typesIsArrayLikeModule: null }), noProblem],
  [
    observation({
      resolutionKind: 'node10',
      typesValueExportNames: ['alpha', 'beta'],
      implementationExportNames: ['alpha'],
    }),
    noProblem,
  ],
  [
    observation({
      typesModuleKind: moduleKind(99),
      typesValueExportNames: ['alpha', 'beta'],
      implementationExportNames: ['alpha'],
    }),
    noProblem,
  ],
  [
    observation({
      implementationModuleKind: moduleKind(99),
      typesValueExportNames: ['alpha', 'beta'],
      implementationExportNames: ['alpha'],
    }),
    noProblem,
  ],
  [
    observation({
      typesIsArrayLikeModule: true,
      typesValueExportNames: ['alpha', 'beta'],
      implementationExportNames: ['alpha'],
    }),
    noProblem,
  ],
  [observation({ typesFileName: null }), noProblem],
  [observation({ implementationFileName: null }), noProblem],
  [observation({ typesValueExportNames: null }), noProblem],
  [observation({ implementationExportNames: null }), noProblem],
]

const allIntendedVerdicts: Arbitrary.Arbitrary<typeof INTENDED_VERDICTS> = Arbitrary.Constant(INTENDED_VERDICTS)

it.prop(
  '∀observation_NamedExports_≡IntendedVerdictTable',
  [allIntendedVerdicts],
  ([rows]) => rows.every(([candidate, intended]) => Equal.equals(observedProblems(candidate), intended)),
)

const referenceProblems = (observation: NamedExportsObservation): ReadonlyArray<PlainProblem> => {
  const commonJsPair = observation.typesModuleKind?.detectedKind === 1 &&
    observation.implementationModuleKind?.detectedKind === 1
  if (observation.resolutionKind !== 'node16-esm' || !commonJsPair) {
    return []
  }
  if (observation.typesIsArrayLikeModule !== false) {
    return []
  }
  const expected = observation.typesValueExportNames
  const implementation = observation.implementationExportNames
  if (
    observation.typesFileName === null ||
    observation.implementationFileName === null ||
    expected === null ||
    implementation === null
  ) {
    return []
  }
  const missing = expected.filter((name) => !implementation.includes(name))
  if (missing.length === 0) {
    return []
  }
  const withoutDefault = (names: readonly string[]): number =>
    names.includes('default') ? names.length - 1 : names.length
  return [{
    kind: 'NamedExportsFound',
    typesFileName: observation.typesFileName,
    implementationFileName: observation.implementationFileName,
    isMissingAllNamed: withoutDefault(missing) === withoutDefault(expected),
    missing,
  }]
}

it.prop(
  '∀observation_NamedExports_≡Reference',
  [DetectNamedExportsCommand],
  ([command]) => Equal.equals(observedProblems(command.observation), referenceProblems(command.observation)),
)

const withIgnoredFields = (observation: NamedExportsObservation): NamedExportsObservation => ({
  ...observation,
  typesModuleKind: observation.typesModuleKind === null
    ? null
    : { ...observation.typesModuleKind, detectedReason: 'no:type', reasonFileName: 'elsewhere.d.ts' },
  implementationModuleKind: observation.implementationModuleKind === null
    ? null
    : { ...observation.implementationModuleKind, detectedReason: 'type', reasonFileName: 'elsewhere.js' },
})

it.prop(
  '∀observation_NamedExports_ignoresUnreadFields',
  [DetectNamedExportsCommand],
  ([command]) =>
    Equal.equals(observedProblems(command.observation), observedProblems(withIgnoredFields(command.observation))),
)
