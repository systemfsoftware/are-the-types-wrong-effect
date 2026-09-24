import { it } from '@effect/vitest'
import { Match, Option, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { classifyTarballRead, ClassifyTarballReadCommand } from '../classify-tarball-read.workflow.js'

const assumedTarball = new Uint8Array([31, 139, 8, 0])

const decisionOf = (directory: string, path: string, bytes: Uint8Array | undefined) =>
  classifyTarballRead(
    new ClassifyTarballReadCommand({
      directory,
      tarballPath: path,
      bytes: bytes === undefined ? Option.none<Uint8Array>() : Option.some(bytes),
    }),
  )

const tagOf = (directory: string, path: string, bytes: Uint8Array | undefined): string =>
  Result.match(decisionOf(directory, path, bytes), {
    onFailure: (refusal) => refusal._tag,
    onSuccess: (decided) => decided._tag,
  })

const directory = Arbitrary.schema(
  Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,24}$/))),
)

const tarballPath = Arbitrary.schema(
  Schema.String.pipe(Schema.check(Schema.isPattern(/^\/tmp\/[a-z][a-z0-9-]{0,16}\/attw\.tgz$/))),
)

const readCase = Arbitrary.all({ directory, path: tarballPath })

it.prop(
  '∀bytes_ReadTarball_∃Evidence',
  [readCase],
  ([{ directory, path }]) =>
    Match.value(decisionOf(directory, path, assumedTarball)).pipe(
      Match.tag('Success', ({ success }) =>
        success.bytes.length === assumedTarball.length &&
        success.ref.packageName === directory &&
        success.ref.packageVersion === 'local' &&
        success.ref.tarballUrl === `file://${path}`),
      Match.tag('Failure', () => false),
      Match.exhaustive,
    ),
)

it.prop(
  '∀paths_MissingBytes_⊥PackFailed',
  [readCase],
  ([{ directory, path }]) => tagOf(directory, path, undefined) === 'PackFailed',
)

it.prop(
  '∀paths_PackFailedIsRepeatableRefusal',
  [readCase],
  ([{ directory, path }]) =>
    Result.match(decisionOf(directory, path, undefined), {
      onFailure: (refusal) => refusal.message.length > 0 && refusal.recovery.includes('--pack'),
      onSuccess: () => false,
    }),
)
