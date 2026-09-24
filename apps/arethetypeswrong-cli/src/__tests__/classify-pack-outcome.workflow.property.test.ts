import { it } from '@effect/vitest'
import { Match, Option, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { classifyPackOutcome, ClassifyPackOutcomeCommand } from '../classify-pack-outcome.workflow.js'

const decisionOf = (directory: string, name: string | undefined, path: string | undefined) =>
  classifyPackOutcome(
    new ClassifyPackOutcomeCommand({
      directory,
      tarballName: name === undefined ? Option.none<string>() : Option.some(name),
      tarballPath: path === undefined ? Option.none<string>() : Option.some(path),
    }),
  )

const tagOf = (directory: string, name: string | undefined, path: string | undefined): string =>
  Result.match(decisionOf(directory, name, path), {
    onFailure: (refusal) => refusal._tag,
    onSuccess: (decided) => decided._tag,
  })

const directory = Arbitrary.schema(
  Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,24}$/))),
)

const tarballName = Arbitrary.schema(
  Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9.-]{0,24}\.tgz$/))),
)

const tarballPath = Arbitrary.schema(
  Schema.String.pipe(Schema.check(Schema.isPattern(/^\/tmp\/[a-z][a-z0-9-]{0,16}\/attw\.tgz$/))),
)

const packCase = Arbitrary.all({ directory, name: tarballName, path: tarballPath })

const refusesUnpackedDirectory = '`npm pack` did not produce a readable tarball in the target directory.'

it.prop(
  '∀paths_PackedTarball_∃DirectoryPacked',
  [packCase],
  ([{ directory, name, path }]) =>
    Match.value(decisionOf(directory, name, path)).pipe(
      Match.tag(
        'Success',
        ({ success }) =>
          success.directory === directory && success.tarballName === name && success.tarballPath === path,
      ),
      Match.tag('Failure', () => false),
      Match.exhaustive,
    ),
)

it.prop(
  '∀directory_MissingPaths_⊥PackFailed',
  [directory],
  ([directory]) => tagOf(directory, undefined, undefined) === 'PackFailed',
)

it.prop(
  '∀paths_HalfMissingPaths_⊥PackFailed',
  [packCase],
  ([{ directory, name, path }]) =>
    tagOf(directory, name, undefined) === 'PackFailed' && tagOf(directory, undefined, path) === 'PackFailed',
)

it.prop(
  '∀directory_PackFailedNamesDirectory',
  [directory],
  ([directory]) =>
    Result.match(decisionOf(directory, undefined, undefined), {
      onFailure: (refusal) => refusal.message === refusesUnpackedDirectory && refusal.recovery.length > 0,
      onSuccess: () => false,
    }),
)
