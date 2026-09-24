import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Result } from 'effect'
import * as S from 'effect/Schema'

const PackEvidenceTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/classify-pack-outcome/PackEvidence',
)
type PackEvidenceTypeId = typeof PackEvidenceTypeId

export class DirectoryPacked extends S.TaggedClass<DirectoryPacked>()('DirectoryPacked', {
  directory: S.String,
  tarballName: S.String,
  tarballPath: S.String,
}) {
  readonly [PackEvidenceTypeId] = PackEvidenceTypeId
}

export type PackEvidence = DirectoryPacked

export class PackFailed extends S.TaggedError<PackFailed>()('PackFailed', {
  message: S.String,
  recovery: S.String,
}) {}

export class ClassifyPackOutcomeCommand extends S.TaggedClass<ClassifyPackOutcomeCommand>()(
  'ClassifyPackOutcomeCommand',
  {
    directory: S.String,
    tarballName: S.Option(S.String),
    tarballPath: S.Option(S.String),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const packFailed = (): PackFailed =>
  new PackFailed({
    message: '`npm pack` did not produce a readable tarball in the target directory.',
    recovery:
      'Run `npm pack` in the target directory to see the failure, fix it, then rerun the same command with --pack.',
  })

export const classifyPackOutcome = Workflow.make({
  command: ClassifyPackOutcomeCommand,
  decision: DirectoryPacked,
  error: PackFailed,
  decide: (command): Result.Result<DirectoryPacked, PackFailed> =>
    Match.value(command.tarballName).pipe(
      Match.tag('Some', ({ value: tarballName }) =>
        Match.value(command.tarballPath).pipe(
          Match.tag('Some', ({ value: tarballPath }) =>
            Result.succeed(
              new DirectoryPacked({ directory: command.directory, tarballName, tarballPath }),
            )),
          Match.tag('None', () => Result.fail(packFailed())),
          Match.exhaustive,
        )),
      Match.tag('None', () => Result.fail(packFailed())),
      Match.exhaustive,
    ),
})
