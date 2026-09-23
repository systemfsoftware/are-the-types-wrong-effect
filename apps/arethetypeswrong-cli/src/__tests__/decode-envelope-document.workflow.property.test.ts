import { it } from '@effect/vitest'
import {
  type CheckResult,
  InternalResolutionErrorProblemSchema,
  type Problem,
  ProblemSchema,
} from '@systemfsoftware/arethetypeswrong'
import { Match, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  decodeEnvelopeDocument,
  EnvelopeDocumentCommand,
  type MaskedProblem,
} from '../decode-envelope-document.workflow.js'
import { decideEnvelope } from '../envelope-document.js'
import { computeExitCode } from '../GetExitCode.js'
import { ComputeExitCodeCommand } from '../GetExitCode.schema.js'
import {
  decideMask,
  defaultEnvelopeMask,
  type EnvelopeMask,
  type EnvelopeMaskField,
  EnvelopeMaskFields,
} from '../Mask.js'
import { CliProblemFlags, CliResolutionKinds, problemFlagForKind } from '../ProblemUtils.js'

const defaultMaskContract: Readonly<Record<EnvelopeMaskField, boolean>> = {
  entrypoints: false,
  buildTools: false,
  programInfo: false,
  traces: false,
}

const oneOfValues = <T>(values: readonly T[]): Arbitrary.Arbitrary<T> =>
  Arbitrary.flatMap(
    Arbitrary.schema(Schema.Literals(values.map((_value, index) => index))),
    (index) => Arbitrary.Constant(values[index]),
  )

const oneOfArbitraries = <A, B>(
  left: Arbitrary.Arbitrary<A>,
  right: Arbitrary.Arbitrary<B>,
): Arbitrary.Arbitrary<A | B> =>
  Arbitrary.flatMap(
    Arbitrary.schema(Schema.Literals(['left', 'right'])),
    (side): Arbitrary.Arbitrary<A | B> => side === 'left' ? left : right,
  )

const tracedInternalResolutionError: Arbitrary.Arbitrary<Problem> = Arbitrary.schema(
  InternalResolutionErrorProblemSchema,
).pipe(
  Arbitrary.map((problem) => ({ ...problem, trace: [...problem.trace, 'trace-entry'] })),
)

const problem: Arbitrary.Arbitrary<Problem> = oneOfArbitraries(
  Arbitrary.schema(ProblemSchema),
  tracedInternalResolutionError,
)

const countByKind = (problems: readonly Problem[]): Record<string, number> =>
  problems.reduce<Record<string, number>>((counts, one) => {
    counts[one.kind] = (counts[one.kind] ?? 0) + 1
    return counts
  }, {})

type WireEnvelope = { readonly [key: string]: WireValue }

type WireValue = Schema.Json | Problem | WireEnvelope | ReadonlyArray<WireValue>

const typedEnvelopeSkeleton = (problems: readonly Problem[]): WireEnvelope => ({
  status: 'ok',
  packageName: 'demo',
  packageVersion: '1.0.0',
  types: { kind: 'included' },
  problems,
  problemCounts: countByKind(problems),
})

const untypedEnvelopeSkeleton = (): WireEnvelope => ({
  status: 'untyped',
  packageName: 'demo',
  packageVersion: '1.0.0',
  types: false,
})

const withoutKey = (document: WireEnvelope, key: string): WireEnvelope =>
  Object.fromEntries(Object.entries(document).filter(([each]) => each !== key))

const refusedDocuments = (generated: Problem): ReadonlyArray<WireEnvelope> => {
  const typed = typedEnvelopeSkeleton([generated])
  const untyped = untypedEnvelopeSkeleton()
  return [
    withoutKey(typed, 'problems'),
    withoutKey(typed, 'problemCounts'),
    withoutKey(typed, 'types'),
    withoutKey(typed, 'packageName'),
    withoutKey(typed, 'packageVersion'),
    withoutKey(typed, 'status'),
    { ...typed, status: 'partial' },
    { ...typed, types: false },
    { ...typed, undeclaredKey: 1 },
    { ...typed, problems: [{ ...generated, undeclaredKey: 1 }] },
    { ...untyped, problems: [generated] },
    { ...untyped, types: true },
    { ...untyped, undeclaredKey: 1 },
  ]
}

const decodeOf = (value: WireEnvelope) => decodeEnvelopeDocument(new EnvelopeDocumentCommand({ value }))

const problemPayload: Arbitrary.Arbitrary<WireValue> = oneOfArbitraries(
  oneOfValues<WireValue>([null, 0, '', {}, []]),
  problem.pipe(Arbitrary.map((one) => [one])),
)

const refusedDocument: Arbitrary.Arbitrary<WireEnvelope> = problem.pipe(
  Arbitrary.flatMap((generated) => oneOfValues(refusedDocuments(generated))),
)

const analysisOf = (problems: readonly Problem[]): CheckResult => ({
  packageName: 'demo',
  packageVersion: '1.0.0',
  buildTools: {},
  types: { kind: 'included' },
  entrypoints: {},
  programInfo: { node10: {}, node16: {}, bundler: {} },
  problems,
})

const untypedResult = (): CheckResult => ({ packageName: 'demo', packageVersion: '1.0.0', types: false })

const mask: Arbitrary.Arbitrary<EnvelopeMask> = oneOfArbitraries(
  Arbitrary.Constant(defaultEnvelopeMask),
  Arbitrary.all({
    entrypoints: Arbitrary.schema(Schema.Boolean),
    buildTools: Arbitrary.schema(Schema.Boolean),
    programInfo: Arbitrary.schema(Schema.Boolean),
    traces: Arbitrary.schema(Schema.Boolean),
  }),
)

const ignores: Arbitrary.Arbitrary<{ readonly rules: readonly string[]; readonly resolutions: readonly string[] }> =
  Arbitrary.all({
    rules: Arbitrary.array(Arbitrary.schema(Schema.Literals(CliProblemFlags)), { maxLength: 3 }),
    resolutions: Arbitrary.array(Arbitrary.schema(Schema.Literals(CliResolutionKinds)), { maxLength: 3 }),
  })

const authoredVisible = (
  one: Problem,
  ignored: { readonly rules: readonly string[]; readonly resolutions: readonly string[] },
): boolean =>
  !ignored.rules.includes(problemFlagForKind(one.kind)) &&
  !('resolutionKind' in one && ignored.resolutions.includes(one.resolutionKind))

const authoredMaskedProblems = (
  problems: readonly Problem[],
  ignored: { readonly rules: readonly string[]; readonly resolutions: readonly string[] },
  maskValue: EnvelopeMask,
): readonly MaskedProblem[] =>
  problems
    .filter((one) => authoredVisible(one, ignored))
    .map((one) => {
      if (maskValue.traces) return one
      if (one.kind === 'InternalResolutionError') {
        const { trace: _trace, ...rest } = one
        return rest
      }
      return one
    })

const sameKindSequence = (left: readonly MaskedProblem[], right: readonly MaskedProblem[]): boolean =>
  left.length === right.length && left.every((one, index) => one.kind === right[index]?.kind)

const defaultMaskHolds = EnvelopeMaskFields.every((field) => defaultEnvelopeMask[field] === defaultMaskContract[field])

it.prop(
  '∀problem_TypedEnvelopeSkeleton_=OkEnvelopeAccepted',
  [problem],
  ([generated]) =>
    Result.match(decodeOf(typedEnvelopeSkeleton([generated])), {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('OkEnvelopeAccepted', ({ document }) =>
            document.packageName === 'demo' &&
            document.packageVersion === '1.0.0' &&
            document.problems.length === 1 &&
            document.problems[0]?.kind === generated.kind),
          Match.tag('UntypedEnvelopeAccepted', () => false),
          Match.exhaustive,
        ),
      onFailure: () => false,
    }),
)

it.prop(
  '∀payload_UntypedEnvelope_⊥problems',
  [problemPayload],
  ([payload]) =>
    Result.match(decodeOf(untypedEnvelopeSkeleton()), {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('UntypedEnvelopeAccepted', () => true),
          Match.tag('OkEnvelopeAccepted', () => false),
          Match.exhaustive,
        ),
      onFailure: () => false,
    }) &&
    Result.isFailure(decodeOf({ ...untypedEnvelopeSkeleton(), problems: payload })),
)

it.prop(
  '∀document_MutatedEnvelope_⊥Decode',
  [refusedDocument],
  ([value]) => Result.isFailure(decodeOf(value)),
)

it.prop(
  '∀problem,mask,ignores,typed_EnvelopeContract_=authoredModel',
  [problem, mask, ignores, Schema.Boolean],
  ([generated, maskValue, ignored, typed]) => {
    let result: CheckResult = untypedResult()
    if (typed) {
      result = analysisOf([generated])
    }
    const decision = decideEnvelope({
      result,
      ignoreRules: [...ignored.rules],
      ignoreResolutions: [...ignored.resolutions],
      mask: maskValue,
    })
    const document = decision.document
    if (!typed) {
      return defaultMaskHolds &&
        document.status === 'untyped' &&
        !('problems' in document) &&
        decision.exitCode === 0
    }
    const expectedProblems = authoredMaskedProblems([generated], ignored, maskValue)
    const expectedExitCode = computeExitCode(
      new ComputeExitCodeCommand({
        result,
        ignoreRules: [...ignored.rules],
        ignoreResolutions: [...ignored.resolutions],
      }),
    ).exitCode
    if (document.status !== 'ok') return false
    return defaultMaskHolds &&
      decision.exitCode === expectedExitCode &&
      ('entrypoints' in document) === maskValue.entrypoints &&
      ('buildTools' in document) === maskValue.buildTools &&
      ('programInfo' in document) === maskValue.programInfo &&
      sameKindSequence(document.problems, expectedProblems) &&
      document.problems.every((one) =>
        one.kind !== 'InternalResolutionError' || ('trace' in one) === maskValue.traces
      ) &&
      Object.values(document.problemCounts).reduce((sum, count) => sum + count, 0) ===
        document.problems.length &&
      Object.entries(document.problemCounts).every(([kind, count]) =>
        count === document.problems.filter((one) => one.kind === kind).length
      )
  },
)

const includeList: Arbitrary.Arbitrary<readonly EnvelopeMaskField[]> = Arbitrary.array(
  Arbitrary.schema(Schema.Literals(EnvelopeMaskFields)),
  { maxLength: 4 },
).pipe(Arbitrary.filter((fields) => new Set(fields).size === fields.length))

const unknownMaskField: Arbitrary.Arbitrary<string> = oneOfArbitraries(
  Arbitrary.schema(Schema.String.pipe(Schema.check(Schema.isPattern(/^[^a-zA-Z]{1,8}$/)))),
  Arbitrary.all([
    Arbitrary.schema(Schema.Literals(EnvelopeMaskFields)),
    Arbitrary.schema(Schema.Literals([' ', '-', 's', '!'])),
  ]).pipe(Arbitrary.map(([field, suffix]) => `${field}${suffix}`)),
)

it.prop('∀include_MaskDecision_=authoredMapping', [includeList], ([include]) => {
  const authoredMapping: Readonly<Record<EnvelopeMaskField, boolean>> = {
    entrypoints: include.includes('entrypoints'),
    buildTools: include.includes('buildTools'),
    programInfo: include.includes('programInfo'),
    traces: include.includes('traces'),
  }
  return Result.match(decideMask(include), {
    onSuccess: (maskValue) => EnvelopeMaskFields.every((field) => maskValue[field] === authoredMapping[field]),
    onFailure: () => false,
  })
})

it.prop('∀field_MaskDecisionRefusal_=field', [unknownMaskField], ([field]) => {
  const decided = decideMask([field])
  return Result.isFailure(decided) && decided.failure.field === field
})
