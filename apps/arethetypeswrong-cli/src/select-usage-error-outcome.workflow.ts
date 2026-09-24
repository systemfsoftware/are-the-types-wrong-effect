import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Result } from 'effect'
import * as S from 'effect/Schema'

const usageErrorRecovery = 'Run `attw --help` to see the accepted commands and flags.'

const UsageErrorDocument = S.fromJsonString(S.Struct({
  status: S.Literal('error'),
  kind: S.String,
  message: S.String,
  recovery: S.String,
}))

const UsageErrorOutcomeDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/UsageErrorOutcomeDecision',
)

type UsageErrorOutcomeDecisionTypeId = typeof UsageErrorOutcomeDecisionTypeId

export class SelectUsageErrorOutcomeCommand extends S.TaggedClass<SelectUsageErrorOutcomeCommand>()(
  'SelectUsageErrorOutcomeCommand',
  {
    kind: S.String,
    message: S.String,
    isTty: S.Boolean,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class UsageErrorProseRendered extends S.TaggedClass<UsageErrorProseRendered>()('UsageErrorProseRendered', {
  document: S.String,
  exitCode: S.Finite,
}) {
  readonly [UsageErrorOutcomeDecisionTypeId] = UsageErrorOutcomeDecisionTypeId
}

export class UsageErrorDocumentEncoded extends S.TaggedClass<UsageErrorDocumentEncoded>()('UsageErrorDocumentEncoded', {
  document: S.String,
  exitCode: S.Finite,
}) {
  readonly [UsageErrorOutcomeDecisionTypeId] = UsageErrorOutcomeDecisionTypeId
}

export type UsageErrorOutcomeDecision = UsageErrorProseRendered | UsageErrorDocumentEncoded

const encodedDocument = (command: SelectUsageErrorOutcomeCommand): string =>
  `${
    Result.getOrThrow(
      S.encodeResult(UsageErrorDocument)({
        status: 'error',
        kind: command.kind,
        message: command.message,
        recovery: usageErrorRecovery,
      }),
    )
  }\n`

const proseOutcome = (command: SelectUsageErrorOutcomeCommand): UsageErrorProseRendered =>
  new UsageErrorProseRendered({
    document: `${command.message}. ${usageErrorRecovery}\n`,
    exitCode: 1,
  })

const encodedOutcome = (command: SelectUsageErrorOutcomeCommand): UsageErrorDocumentEncoded =>
  new UsageErrorDocumentEncoded({ document: encodedDocument(command), exitCode: 1 })

export const selectUsageErrorOutcome = Workflow.make({
  command: SelectUsageErrorOutcomeCommand,
  decision: S.Union([UsageErrorProseRendered, UsageErrorDocumentEncoded]),
  error: S.Never,
  decide: (command): Result.Result<UsageErrorOutcomeDecision, never> =>
    Match.value(command.isTty).pipe(
      Match.when(true, () => Result.succeed(proseOutcome(command))),
      Match.when(false, () => Result.succeed(encodedOutcome(command))),
      Match.exhaustive,
    ),
})
