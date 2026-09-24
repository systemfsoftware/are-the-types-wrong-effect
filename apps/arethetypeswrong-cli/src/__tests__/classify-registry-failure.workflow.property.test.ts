import { it } from '@effect/vitest'
import { Match, Option, Predicate, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  classifyRegistryFailure,
  ClassifyRegistryFailureCommand,
  RegistryAnsweredSuccessfully,
  RegistryNoResponseObserved,
  type RegistryObservation,
  RegistryStatusObserved,
  RegistryUnreadableShapeObserved,
} from '../classify-registry-failure.workflow.js'
import { type AttwFailure, FailureDocumentJson } from '../Failure.schema.js'
import { failureOutcome } from '../render-report.cell.js'

type StatusClass = 'notFound' | 'answered' | 'badResponse'

const statusClassBoundaryTable: ReadonlyArray<{ readonly status: number; readonly expected: StatusClass }> = [
  { status: 199, expected: 'badResponse' },
  { status: 200, expected: 'answered' },
  { status: 201, expected: 'answered' },
  { status: 298, expected: 'answered' },
  { status: 299, expected: 'answered' },
  { status: 300, expected: 'badResponse' },
  { status: 403, expected: 'badResponse' },
  { status: 404, expected: 'notFound' },
  { status: 405, expected: 'badResponse' },
]

const authoredStatusClass = (status: number): StatusClass => {
  if (status === 404) return 'notFound'
  if (status >= 200 && status < 300) return 'answered'
  return 'badResponse'
}

const classificationOf = (observation: RegistryObservation) =>
  classifyRegistryFailure(new ClassifyRegistryFailureCommand({ observation }))

const decidedFailureOf = (observation: RegistryObservation): Option.Option<AttwFailure> =>
  Result.match(classificationOf(observation), {
    onFailure: () => Option.none(),
    onSuccess: (decided) => Option.some(decided),
  })

const statusOf = (observation: RegistryObservation): Option.Option<number> =>
  Match.value(observation).pipe(
    Match.tag('RegistryStatusObserved', ({ status }) => Option.some(status)),
    Match.orElse(() => Option.none<number>()),
  )

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

const statusRange: Arbitrary.Arbitrary<number> = Arbitrary.schema(
  Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 599 }))),
)

const statusObservation: Arbitrary.Arbitrary<RegistryStatusObserved> = statusRange.pipe(
  Arbitrary.map((status) => new RegistryStatusObserved({ status })),
)

const structuralObservation: Arbitrary.Arbitrary<RegistryObservation> = oneOfValues([
  new RegistryNoResponseObserved(),
  new RegistryUnreadableShapeObserved(),
])

const observation: Arbitrary.Arbitrary<RegistryObservation> = oneOfArbitraries(
  statusObservation,
  structuralObservation,
)

const rawCause: Arbitrary.Arbitrary<string> = Arbitrary.schema(
  Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{8,16}$/))),
).pipe(Arbitrary.map((hex) => `<<raw-registry-cause:${hex}>>`))

type RawStatusObservation = RegistryStatusObserved & { readonly cause: string }

const rawStatusObservation: Arbitrary.Arbitrary<RawStatusObservation> = Arbitrary.all([statusRange, rawCause]).pipe(
  Arbitrary.map(([status, cause]): RawStatusObservation => ({
    _tag: 'RegistryStatusObserved',
    status,
    cause,
  })),
)

const authoredNotFoundMessage = 'The registry has no package or version matching that target.'
const authoredNotFoundRecovery = 'Check the package name and version, then rerun the same command.'

const holdsBoundaryRow = (row: { readonly status: number; readonly expected: StatusClass }): boolean =>
  Match.value(classificationOf(new RegistryStatusObserved({ status: row.status }))).pipe(
    Match.tag('Success', ({ success: decided }) =>
      Match.value(row.expected).pipe(
        Match.when('notFound', () =>
          Predicate.isTagged(decided, 'RegistryNotFound') &&
          decided.message === authoredNotFoundMessage &&
          decided.recovery === authoredNotFoundRecovery),
        Match.when('badResponse', () =>
          Predicate.isTagged(decided, 'RegistryBadResponse') &&
          decided.message.includes(String(row.status))),
        Match.when('answered', () => false),
        Match.exhaustive,
      )),
    Match.tag('Failure', ({ failure: answered }) => row.expected === 'answered' && answered.status === row.status),
    Match.exhaustive,
  )

const authoredTagFor = (generated: RegistryObservation): string =>
  Match.value(generated).pipe(
    Match.tag('RegistryNoResponseObserved', () => 'RegistryUnreachable'),
    Match.tag('RegistryUnreadableShapeObserved', () => 'RegistryBadResponse'),
    Match.tag('RegistryStatusObserved', ({ status }) =>
      Match.value(authoredStatusClass(status)).pipe(
        Match.when('notFound', () => 'RegistryNotFound'),
        Match.when('badResponse', () => 'RegistryBadResponse'),
        Match.when('answered', () => 'RegistryAnsweredSuccessfully'),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const holdsAuthoredModel = (generated: RegistryObservation): boolean => {
  const expectedTag = authoredTagFor(generated)
  const status = statusOf(generated)
  return Match.value(classificationOf(generated)).pipe(
    Match.tag('Success', ({ success: decided }) =>
      expectedTag !== 'RegistryAnsweredSuccessfully' &&
      Predicate.isTagged(decided, expectedTag) &&
      decided.message.length > 0 &&
      decided.recovery.length > 0),
    Match.tag('Failure', ({ failure: answered }) =>
      expectedTag === 'RegistryAnsweredSuccessfully' &&
      Option.exists(status, (observed) => observed === answered.status)),
    Match.exhaustive,
  )
}

const debugJson = (value: AttwFailure | RegistryAnsweredSuccessfully): string =>
  Match.value(Schema.encodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(value)).pipe(
    Match.tag('Success', ({ success: text }) => text),
    Match.tag('Failure', () => ''),
    Match.exhaustive,
  )

const holdsRenderedDocument = (failure: AttwFailure, isTty: boolean): boolean => {
  const outcome = failureOutcome(failure, { isTty })
  if (outcome.exitCode !== 1) return false
  if (isTty) {
    const body = outcome.document.trimEnd()
    return outcome.document.endsWith('\n') && !body.includes('\n') &&
      body.includes(failure.message) && body.includes(failure.recovery)
  }
  return Result.match(
    Schema.decodeResult(FailureDocumentJson, { onExcessProperty: 'error' })(outcome.document),
    {
      onSuccess: (document) =>
        Predicate.isTagged(failure, document.kind) &&
        document.message === failure.message &&
        document.recovery === failure.recovery,
      onFailure: () => false,
    },
  )
}

it.prop(
  '∀row_RegistryStatusBoundary_=authoredClass',
  [oneOfValues(statusClassBoundaryTable)],
  ([row]) => holdsBoundaryRow(row),
)

it.prop(
  '∀status_RegistryStatusClass_=authoredClass',
  [statusObservation],
  ([generated]) => holdsAuthoredModel(generated),
)

it.prop(
  '∀observation_StructuralObservation_=authoredClass',
  [structuralObservation],
  ([generated]) => holdsAuthoredModel(generated),
)

it.prop(
  '∀observation_Decided_=renderedDocument',
  [observation],
  ([generated]) =>
    Option.match(decidedFailureOf(generated), {
      onNone: () =>
        Match.value(generated).pipe(
          Match.tag('RegistryStatusObserved', ({ status }) => status >= 200 && status < 300),
          Match.orElse(() => false),
        ),
      onSome: (failure) => holdsRenderedDocument(failure, false) && holdsRenderedDocument(failure, true),
    }),
)

it.prop('∀observation_RawCause_≠Decided', [rawStatusObservation], ([raw]) => {
  const cause = raw.cause
  return Match.value(classificationOf(raw)).pipe(
    Match.tag('Success', ({ success: decided }) =>
      cause.length > 0 &&
      !decided.message.includes(cause) &&
      !decided.recovery.includes(cause) &&
      !debugJson(decided).includes(cause) &&
      !failureOutcome(decided, { isTty: false }).document.includes(cause) &&
      !failureOutcome(decided, { isTty: true }).document.includes(cause)),
    Match.tag('Failure', ({ failure: answered }) => cause.length > 0 && !debugJson(answered).includes(cause)),
    Match.exhaustive,
  )
})
