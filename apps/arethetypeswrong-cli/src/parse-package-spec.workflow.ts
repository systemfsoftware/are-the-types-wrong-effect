import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Array, Match, Option, Result } from 'effect'
import * as S from 'effect/Schema'

import { PackageSpecVersionKindSchema, type ParsedPackageSpec, ParsedPackageSpecSchema } from './PackageSpec.schema.js'

const PackageSpecDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/PackageSpecDecision',
)
type PackageSpecDecisionTypeId = typeof PackageSpecDecisionTypeId

export class InvalidPackageName extends S.TaggedError<InvalidPackageName>()('InvalidPackageName', {
  name: S.String,
}) {
  readonly [PackageSpecDecisionTypeId] = PackageSpecDecisionTypeId
}

export class MalformedScope extends S.TaggedError<MalformedScope>()('MalformedScope', { target: S.String }) {
  readonly [PackageSpecDecisionTypeId] = PackageSpecDecisionTypeId
}

export class IllFormedUnicode extends S.TaggedError<IllFormedUnicode>()('IllFormedUnicode', { target: S.String }) {
  readonly [PackageSpecDecisionTypeId] = PackageSpecDecisionTypeId
}

export type PackageSpecRefusal = InvalidPackageName | MalformedScope | IllFormedUnicode

export class PackageSpecParsed extends S.TaggedClass<PackageSpecParsed>()('PackageSpecParsed', {
  spec: ParsedPackageSpecSchema,
}) {
  readonly [PackageSpecDecisionTypeId] = PackageSpecDecisionTypeId
}

export type PackageSpecDecision = PackageSpecParsed

export class ParsePackageSpecCommand extends S.TaggedClass<ParsePackageSpecCommand>()('ParsePackageSpecCommand', {
  target: S.String,
  wellFormed: S.Boolean,
  scopeShape: S.Literals(['unscoped', 'scoped', 'malformed']),
  nameErrors: S.Array(S.String),
  versionShape: S.Literals(['none', 'exact', 'range', 'tag']),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const splitAt = (target: string, fromIndex: number) => {
  const at = target.indexOf('@', fromIndex)
  return Match.value(at).pipe(
    Match.when(-1, () => ({ name: target, version: '' })),
    Match.orElse((separator) => ({ name: target.slice(0, separator), version: target.slice(separator + 1) })),
  )
}

const splitNameAndVersion = (target: string, scopeShape: 'unscoped' | 'scoped' | 'malformed') =>
  Match.value(scopeShape).pipe(
    Match.when('unscoped', () => splitAt(target, 0)),
    Match.when('scoped', () => splitAt(target, target.indexOf('/'))),
    Match.when('malformed', () => splitAt(target, 0)),
    Match.exhaustive,
  )

const refusalsIn = (command: ParsePackageSpecCommand): ReadonlyArray<PackageSpecRefusal> => {
  const illFormed = Match.value(command.wellFormed).pipe(
    Match.when(false, (): ReadonlyArray<PackageSpecRefusal> => [new IllFormedUnicode({ target: command.target })]),
    Match.when(true, (): ReadonlyArray<PackageSpecRefusal> => []),
    Match.exhaustive,
  )
  const scope = Match.value(command.scopeShape).pipe(
    Match.when('malformed', (): ReadonlyArray<PackageSpecRefusal> => [new MalformedScope({ target: command.target })]),
    Match.orElse((): ReadonlyArray<PackageSpecRefusal> => []),
  )
  const name = Match.value(command.nameErrors.length > 0).pipe(
    Match.when(true, (): ReadonlyArray<PackageSpecRefusal> => [new InvalidPackageName({ name: command.target })]),
    Match.when(false, (): ReadonlyArray<PackageSpecRefusal> => []),
    Match.exhaustive,
  )
  return [...illFormed, ...scope, ...name]
}

const firstRefusal = (command: ParsePackageSpecCommand) =>
  Match.value(Array.get(refusalsIn(command), 0)).pipe(
    Match.tag('Some', ({ value }) => Option.some(value)),
    Match.tag('None', () => Option.none<PackageSpecRefusal>()),
    Match.exhaustive,
  )

const parsedSpec = (command: ParsePackageSpecCommand): ParsedPackageSpec => {
  const parts = splitNameAndVersion(command.target, command.scopeShape)
  const versionKind: S.Schema.Type<typeof PackageSpecVersionKindSchema> = Match.value(command.versionShape).pipe(
    Match.when('none', () => 'none' as const),
    Match.when('exact', () => 'exact' as const),
    Match.when('range', () => 'range' as const),
    Match.when('tag', () => 'tag' as const),
    Match.exhaustive,
  )
  return { name: parts.name, version: parts.version, versionKind }
}

export const parsePackageSpec = Workflow.make({
  command: ParsePackageSpecCommand,
  decision: PackageSpecParsed,
  error: S.Union([InvalidPackageName, MalformedScope, IllFormedUnicode]),
  decide: (command): Result.Result<PackageSpecDecision, PackageSpecRefusal> =>
    Match.value(firstRefusal(command)).pipe(
      Match.tag('Some', ({ value }) => Result.fail(value)),
      Match.tag('None', () => Result.succeed(new PackageSpecParsed({ spec: parsedSpec(command) }))),
      Match.exhaustive,
    ),
})
