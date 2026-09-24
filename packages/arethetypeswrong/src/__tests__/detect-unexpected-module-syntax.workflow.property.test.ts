import { it } from '@effect/vitest'
import { Equal, Result } from 'effect'
import * as Match from 'effect/Match'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  detectUnexpectedModuleSyntax,
  DetectUnexpectedModuleSyntaxCommand,
} from '../detect-unexpected-module-syntax.workflow.js'
import type { UnexpectedModuleSyntaxObservation } from '../Observation.schema.js'
import { type ModuleKind } from '../Problem.schema.js'

interface PlainProblem {
  readonly kind: string
  readonly fileName: string
  readonly pos: number
  readonly end: number
  readonly syntax: 1 | 99
  readonly moduleKind: ModuleKind
}

const observedProblems = (observation: UnexpectedModuleSyntaxObservation): ReadonlyArray<PlainProblem> =>
  Result.match(
    detectUnexpectedModuleSyntax(new DetectUnexpectedModuleSyntaxCommand({ observation })),
    {
      onFailure: (): ReadonlyArray<PlainProblem> => [],
      onSuccess: (problems) =>
        problems.map((problem) =>
          Match.value(problem).pipe(
            Match.tag(
              'UnexpectedModuleSyntaxFound',
              ({ fileName, pos, end, syntax, moduleKind }): PlainProblem => ({
                kind: 'UnexpectedModuleSyntaxFound',
                fileName,
                pos,
                end,
                syntax,
                moduleKind,
              }),
            ),
            Match.exhaustive,
          )
        ),
    },
  )

const observation = (overrides: {
  readonly fileName?: string
  readonly expectedModuleKind?: ModuleKind
  readonly impliedSyntax?: 1 | 99 | null
  readonly pos?: number | null
  readonly end?: number | null
}): UnexpectedModuleSyntaxObservation => ({
  fileName: 'dist/index.js',
  expectedModuleKind: { detectedKind: 1, detectedReason: 'type', reasonFileName: 'package.json' },
  impliedSyntax: null,
  pos: null,
  end: null,
  ...overrides,
})

const expectedKind: ModuleKind = { detectedKind: 1, detectedReason: 'type', reasonFileName: 'package.json' }

const noProblem: readonly PlainProblem[] = []
const syntaxProblem: PlainProblem = {
  kind: 'UnexpectedModuleSyntaxFound',
  fileName: 'dist/index.js',
  pos: 0,
  end: 10,
  syntax: 99,
  moduleKind: expectedKind,
}

const INTENDED_VERDICTS: ReadonlyArray<readonly [UnexpectedModuleSyntaxObservation, ReadonlyArray<PlainProblem>]> = [
  [observation({ impliedSyntax: null, pos: 0, end: 10 }), noProblem],
  [observation({ impliedSyntax: 1, pos: 0, end: 10 }), noProblem],
  [observation({ impliedSyntax: 99, pos: 0, end: 10 }), [syntaxProblem]],
  [observation({ impliedSyntax: 99, pos: null, end: 10 }), noProblem],
  [observation({ impliedSyntax: 99, pos: 0, end: null }), noProblem],
  [
    observation({
      fileName: 'dist/other.js',
      expectedModuleKind: { detectedKind: 99, detectedReason: 'extension', reasonFileName: 'index.mjs' },
      impliedSyntax: 1,
      pos: 4,
      end: 9,
    }),
    [
      {
        kind: 'UnexpectedModuleSyntaxFound',
        fileName: 'dist/other.js',
        pos: 4,
        end: 9,
        syntax: 1,
        moduleKind: { detectedKind: 99, detectedReason: 'extension', reasonFileName: 'index.mjs' },
      },
    ],
  ],
]

const allIntendedVerdicts: Arbitrary.Arbitrary<typeof INTENDED_VERDICTS> = Arbitrary.Constant(INTENDED_VERDICTS)

it.prop(
  '∀observation_UnexpectedModuleSyntax_≡IntendedVerdictTable',
  [allIntendedVerdicts],
  ([rows]) => rows.every(([candidate, intended]) => Equal.equals(observedProblems(candidate), intended)),
)

const referenceProblems = (observation: UnexpectedModuleSyntaxObservation): ReadonlyArray<PlainProblem> => {
  const implied = observation.impliedSyntax
  if (implied === null || implied === observation.expectedModuleKind.detectedKind) {
    return []
  }
  if (observation.pos === null || observation.end === null) {
    return []
  }
  return [{
    kind: 'UnexpectedModuleSyntaxFound',
    fileName: observation.fileName,
    pos: observation.pos,
    end: observation.end,
    syntax: implied,
    moduleKind: observation.expectedModuleKind,
  }]
}

it.prop(
  '∀observation_UnexpectedModuleSyntax_≡Reference',
  [DetectUnexpectedModuleSyntaxCommand],
  ([command]) => Equal.equals(observedProblems(command.observation), referenceProblems(command.observation)),
)
