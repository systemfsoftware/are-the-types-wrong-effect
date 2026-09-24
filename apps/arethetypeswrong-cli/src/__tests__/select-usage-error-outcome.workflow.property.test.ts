import { it } from '@effect/vitest'
import { Match, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  selectUsageErrorOutcome,
  SelectUsageErrorOutcomeCommand,
  UsageErrorDocumentSchema,
  type UsageErrorOutcomeDecision,
} from '../select-usage-error-outcome.workflow.js'

interface UsageErrorRow {
  readonly kind: string
  readonly message: string
  readonly isTty: boolean
  readonly expectedTag: 'UsageErrorDocumentEncoded' | 'UsageErrorProseRendered'
  readonly expectedDocument: string
  readonly expectedExitCode: number
}

const usageErrorRows: readonly UsageErrorRow[] = [
  {
    kind: 'ShowHelp',
    message: 'attw --help',
    isTty: true,
    expectedTag: 'UsageErrorProseRendered',
    expectedDocument: 'attw --help. Run `attw --help` to see the accepted commands and flags.\n',
    expectedExitCode: 1,
  },
  {
    kind: 'ShowHelp',
    message: 'attw --help',
    isTty: false,
    expectedTag: 'UsageErrorDocumentEncoded',
    expectedDocument:
      '{"status":"error","kind":"ShowHelp","message":"attw --help","recovery":"Run `attw --help` to see the accepted commands and flags."}\n',
    expectedExitCode: 1,
  },
  {
    kind: 'MissingValue',
    message: 'Missing value for flag --format',
    isTty: true,
    expectedTag: 'UsageErrorProseRendered',
    expectedDocument: 'Missing value for flag --format. Run `attw --help` to see the accepted commands and flags.\n',
    expectedExitCode: 1,
  },
  {
    kind: 'MissingValue',
    message: 'Missing value for flag --format',
    isTty: false,
    expectedTag: 'UsageErrorDocumentEncoded',
    expectedDocument:
      '{"status":"error","kind":"MissingValue","message":"Missing value for flag --format","recovery":"Run `attw --help` to see the accepted commands and flags."}\n',
    expectedExitCode: 1,
  },
  {
    kind: 'UnknownCommand',
    message: 'Unknown command `attw frobnicate`',
    isTty: false,
    expectedTag: 'UsageErrorDocumentEncoded',
    expectedDocument:
      '{"status":"error","kind":"UnknownCommand","message":"Unknown command `attw frobnicate`","recovery":"Run `attw --help` to see the accepted commands and flags."}\n',
    expectedExitCode: 1,
  },
  {
    kind: 'InvalidValue',
    message: 'Invalid value for flag --format',
    isTty: true,
    expectedTag: 'UsageErrorProseRendered',
    expectedDocument: 'Invalid value for flag --format. Run `attw --help` to see the accepted commands and flags.\n',
    expectedExitCode: 1,
  },
]

const oneOfValues = <T>(values: readonly T[]): Arbitrary.Arbitrary<T> =>
  Arbitrary.flatMap(
    Arbitrary.schema(Schema.Literals(values.map((_value, index) => index))),
    (index) => Arbitrary.Constant(values[index]),
  )

const decidedOf = (command: SelectUsageErrorOutcomeCommand): UsageErrorOutcomeDecision =>
  Result.getOrThrow(selectUsageErrorOutcome(command))

const everyUsageErrorDocument: Arbitrary.Arbitrary<readonly string[]> = Arbitrary.Constant([
  '{"status":"error","kind":"ShowHelp","message":"attw --help","recovery":"Run `attw --help` to see the accepted commands and flags."}',
])

const everyRefusedUsageErrorDocument: Arbitrary.Arbitrary<readonly string[]> = Arbitrary.Constant([
  '{"status":"ok","kind":"ShowHelp","message":"attw --help","recovery":"Run `attw --help`."}',
  '{"kind":"ShowHelp","message":"attw --help","recovery":"Run `attw --help`."}',
  '{"status":"error","message":"attw --help","recovery":"Run `attw --help`."}',
  '{"status":"error","kind":"ShowHelp","message":"attw --help"}',
  '{"status":"error","kind":1,"message":"attw --help","recovery":"Run `attw --help`."}',
  '{"status":"error","kind":"ShowHelp","message":"attw --help","recovery":false}',
])

it.prop(
  '∀document_UsageErrorDocument_=Decoded',
  [everyUsageErrorDocument],
  ([documents]) =>
    documents.every((document) =>
      Result.match(Schema.decodeResult(Schema.fromJsonString(UsageErrorDocumentSchema))(document), {
        onSuccess: (decoded) =>
          decoded.kind === 'ShowHelp' &&
          decoded.message === 'attw --help' &&
          decoded.recovery === 'Run `attw --help` to see the accepted commands and flags.',
        onFailure: () => false,
      })
    ),
)

it.prop(
  '∀document_NotUsageErrorDocument_⊥Decode',
  [everyRefusedUsageErrorDocument],
  ([documents]) =>
    documents.every((document) =>
      Result.isFailure(Schema.decodeResult(Schema.fromJsonString(UsageErrorDocumentSchema))(document))
    ),
)

it.prop('∀row_SelectUsageErrorOutcome_=authoredTable', [oneOfValues(usageErrorRows)], ([row]) => {
  const decision = decidedOf(
    new SelectUsageErrorOutcomeCommand({ kind: row.kind, message: row.message, isTty: row.isTty }),
  )
  return Match.value(decision).pipe(
    Match.tag('UsageErrorProseRendered', (prose) =>
      row.expectedTag === 'UsageErrorProseRendered' &&
      prose.document === row.expectedDocument &&
      prose.exitCode === row.expectedExitCode),
    Match.tag('UsageErrorDocumentEncoded', (encoded) =>
      row.expectedTag === 'UsageErrorDocumentEncoded' &&
      encoded.document === row.expectedDocument &&
      encoded.exitCode === row.expectedExitCode),
    Match.exhaustive,
  )
})
