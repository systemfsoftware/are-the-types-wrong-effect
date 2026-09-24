import { it } from '@effect/vitest'
import { Equal, Result } from 'effect'
import * as Match from 'effect/Match'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  detectExportDefaultDisagreement,
  DetectExportDefaultDisagreementCommand,
} from '../detect-export-default-disagreement.workflow.js'
import {
  type ExportDefaultDisagreementObservation,
  type ImplementationDefaultFacts,
  type TypesDefaultFacts,
} from '../Observation.schema.js'
import { type ModuleKind } from '../Problem.schema.js'

interface PlainProblem {
  readonly kind: string
  readonly typesFileName: string
  readonly implementationFileName: string
}

const observedProblems = (observation: ExportDefaultDisagreementObservation): ReadonlyArray<PlainProblem> =>
  Result.match(
    detectExportDefaultDisagreement(new DetectExportDefaultDisagreementCommand({ observation })),
    {
      onFailure: (): ReadonlyArray<PlainProblem> => [],
      onSuccess: (problems) =>
        problems.map((problem) =>
          Match.value(problem).pipe(
            Match.tag('FalseExportDefaultFound', ({ typesFileName, implementationFileName }): PlainProblem => ({
              kind: 'FalseExportDefaultFound',
              typesFileName,
              implementationFileName,
            })),
            Match.tag('MissingExportEqualsFound', ({ typesFileName, implementationFileName }): PlainProblem => ({
              kind: 'MissingExportEqualsFound',
              typesFileName,
              implementationFileName,
            })),
            Match.exhaustive,
          )
        ),
    },
  )

const observation = (overrides: {
  readonly typesModuleKind?: ModuleKind | null
  readonly implementationModuleKind?: ModuleKind | null
  readonly typesFileName?: string | null
  readonly implementationFileName?: string | null
  readonly types?: Partial<TypesDefaultFacts>
  readonly implementation?: Partial<ImplementationDefaultFacts>
}): ExportDefaultDisagreementObservation => {
  const base: ExportDefaultDisagreementObservation = {
    typesFileName: 'types.d.ts',
    implementationFileName: 'index.js',
    resolutionKind: 'node16-cjs',
    typesModuleKind: null,
    implementationModuleKind: null,
    types: {
      hasDefaultExportSymbol: false,
      hasDefaultSymbol: false,
      hasExportEquals: false,
      hasNonDefaultValueExport: false,
      defaultTypeIsObject: false,
      defaultTypeHasCallOrConstructSignatures: false,
    },
    implementation: {
      hasDefault: false,
      exportEqualsSharesContainer: true,
      exportsAreAnalyzable: true,
      hasExportEquals: false,
      exportEqualsIsExportDefault: false,
      moduleExportsTypeHasCallOrConstructSignatures: false,
      hasNonDefaultExport: false,
    },
  }
  return {
    ...base,
    ...overrides,
    types: { ...base.types, ...overrides.types },
    implementation: { ...base.implementation, ...overrides.implementation },
  }
}

const moduleKind = (detectedKind: 1 | 99): ModuleKind => ({
  detectedKind,
  detectedReason: 'type',
  reasonFileName: 'types.d.ts',
})

const noProblem: readonly PlainProblem[] = []
const declaredProblem: PlainProblem = {
  kind: 'MissingExportEqualsFound',
  typesFileName: 'types.d.ts',
  implementationFileName: 'index.js',
}

const INTENDED_VERDICTS: ReadonlyArray<readonly [ExportDefaultDisagreementObservation, ReadonlyArray<PlainProblem>]> = [
  [observation({ typesModuleKind: moduleKind(99) }), noProblem],
  [observation({ implementationModuleKind: moduleKind(99) }), noProblem],
  [
    observation({
      typesModuleKind: moduleKind(1),
      types: { hasDefaultExportSymbol: true, hasDefaultSymbol: true },
      implementation: { hasDefault: false },
    }),
    [{ kind: 'FalseExportDefaultFound', typesFileName: 'types.d.ts', implementationFileName: 'index.js' }],
  ],
  [
    observation({
      typesModuleKind: moduleKind(99),
      types: { hasDefaultExportSymbol: true, hasDefaultSymbol: true },
      implementation: { hasDefault: false },
    }),
    noProblem,
  ],
  [observation({ typesFileName: null }), noProblem],
  [observation({ implementationFileName: null }), noProblem],
  [
    observation({
      types: { hasDefaultExportSymbol: true, hasDefaultSymbol: true },
      implementation: { hasDefault: false },
    }),
    [{ kind: 'FalseExportDefaultFound', typesFileName: 'types.d.ts', implementationFileName: 'index.js' }],
  ],
  [
    observation({
      types: { hasDefaultExportSymbol: true, hasDefaultSymbol: true },
      implementation: { hasDefault: false, exportsAreAnalyzable: false },
    }),
    noProblem,
  ],
  [
    observation({
      types: { hasDefaultSymbol: true, defaultTypeHasCallOrConstructSignatures: true },
      implementation: { hasDefault: true, hasExportEquals: true, exportEqualsIsExportDefault: true },
    }),
    [declaredProblem],
  ],
  [
    observation({
      types: { hasDefaultSymbol: true },
      implementation: { hasDefault: true, hasExportEquals: true, moduleExportsTypeHasCallOrConstructSignatures: true },
    }),
    [declaredProblem],
  ],
  [
    observation({
      types: { hasDefaultSymbol: true, hasExportEquals: true },
      implementation: { hasDefault: true, hasExportEquals: true, moduleExportsTypeHasCallOrConstructSignatures: true },
    }),
    noProblem,
  ],
  [
    observation({
      types: { hasDefaultSymbol: true },
      implementation: {
        hasDefault: true,
        hasExportEquals: true,
        exportEqualsIsExportDefault: true,
        moduleExportsTypeHasCallOrConstructSignatures: false,
      },
    }),
    noProblem,
  ],
  [
    observation({
      types: { hasDefaultSymbol: true, defaultTypeIsObject: true },
      implementation: { hasDefault: true, hasNonDefaultExport: true },
    }),
    [declaredProblem],
  ],
  [
    observation({
      types: { hasDefaultSymbol: true, defaultTypeIsObject: true, hasNonDefaultValueExport: true },
      implementation: { hasDefault: true, hasNonDefaultExport: true },
    }),
    noProblem,
  ],
  [
    observation({
      types: { defaultTypeIsObject: true },
      implementation: { hasDefault: true, hasNonDefaultExport: true },
    }),
    noProblem,
  ],
  [observation({}), noProblem],
]

const allIntendedVerdicts: Arbitrary.Arbitrary<typeof INTENDED_VERDICTS> = Arbitrary.Constant(INTENDED_VERDICTS)

it.prop(
  '∀observation_ExportDefaultDisagreement_≡IntendedVerdictTable',
  [allIntendedVerdicts],
  ([rows]) => rows.every(([candidate, intended]) => Equal.equals(observedProblems(candidate), intended)),
)

const signaturesMismatch = (observation: ExportDefaultDisagreementObservation): boolean =>
  (observation.implementation.exportEqualsIsExportDefault &&
    observation.types.defaultTypeHasCallOrConstructSignatures) ||
  observation.implementation.moduleExportsTypeHasCallOrConstructSignatures

const referenceProblems = (observation: ExportDefaultDisagreementObservation): ReadonlyArray<PlainProblem> => {
  if (observation.typesModuleKind?.detectedKind === 99) {
    return []
  }
  if (observation.implementationModuleKind?.detectedKind === 99) {
    return []
  }
  if (observation.typesFileName === null || observation.implementationFileName === null) {
    return []
  }
  const placement = {
    typesFileName: observation.typesFileName,
    implementationFileName: observation.implementationFileName,
  }
  const analyzable = observation.implementation.exportEqualsSharesContainer &&
    observation.implementation.exportsAreAnalyzable
  if (observation.types.hasDefaultExportSymbol && !observation.implementation.hasDefault && analyzable) {
    return [{ kind: 'FalseExportDefaultFound', ...placement }]
  }
  const exportEqualsRoute = !observation.types.hasExportEquals &&
    observation.implementation.hasExportEquals &&
    observation.types.hasDefaultSymbol &&
    signaturesMismatch(observation)
  const objectyRoute = !observation.types.hasNonDefaultValueExport &&
    observation.types.defaultTypeIsObject &&
    observation.implementation.hasNonDefaultExport &&
    observation.types.hasDefaultSymbol
  if (observation.implementation.hasDefault && analyzable && (exportEqualsRoute || objectyRoute)) {
    return [{ kind: 'MissingExportEqualsFound', ...placement }]
  }
  return []
}

it.prop(
  '∀observation_ExportDefaultDisagreement_≡Reference',
  [DetectExportDefaultDisagreementCommand],
  ([command]) => Equal.equals(observedProblems(command.observation), referenceProblems(command.observation)),
)

const withIgnoredFields = (
  observation: ExportDefaultDisagreementObservation,
): ExportDefaultDisagreementObservation => ({
  ...observation,
  resolutionKind: observation.resolutionKind === 'node10' ? 'bundler' : 'node10',
})

it.prop(
  '∀observation_ExportDefaultDisagreement_ignoresUnreadFields',
  [DetectExportDefaultDisagreementCommand],
  ([command]) =>
    Equal.equals(
      observedProblems(command.observation),
      observedProblems(withIgnoredFields(command.observation)),
    ),
)
