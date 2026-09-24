import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { it } from '@effect/vitest'
import { Cause, Effect, Layer, Match, Result } from 'effect'
import * as Spawner from 'effect/unstable/process/ChildProcessSpawner'
import { describe, expect } from 'vitest'

import * as NpmPackRunner from '../src/drivers/npm-pack-runner.js'
import { type PackResult, PackRunner } from '../src/pack-runner.service.js'
import { PackRunnerOutputUnreadable, PackRunnerSpawnRefused } from '../src/PackRunnerError.schema.js'

const PACK_TIMEOUT = '250 millis'

const platformBase = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const hangingSpawner = Layer.succeed(Spawner.ChildProcessSpawner, Spawner.make(() => Effect.never))

const packRunnerLayer = NpmPackRunner.layer({ timeout: PACK_TIMEOUT }).pipe(
  Layer.provide(Layer.mergeAll(platformBase, hangingSpawner)),
)

type PackOutcome =
  | { readonly tag: 'packed' }
  | { readonly tag: 'PackRunnerSpawnRefused'; readonly timedOut: boolean }
  | { readonly tag: 'PackRunnerOutputUnreadable' }

const packOutcomeOf = (
  attempt: Result.Result<PackResult, PackRunnerSpawnRefused | PackRunnerOutputUnreadable>,
): PackOutcome =>
  Result.match(attempt, {
    onSuccess: (): PackOutcome => ({ tag: 'packed' }),
    onFailure: (failure): PackOutcome =>
      Match.value(failure).pipe(
        Match.tag('PackRunnerSpawnRefused', (refused): PackOutcome => ({
          tag: 'PackRunnerSpawnRefused',
          timedOut: Cause.isTimeoutError(refused.cause),
        })),
        Match.tag('PackRunnerOutputUnreadable', (): PackOutcome => ({ tag: 'PackRunnerOutputUnreadable' })),
        Match.exhaustive,
      ),
  })

describe('npm-pack-runner: the pack command boundary', () => {
  it.live('gives up on a pack command that never returns', () =>
    Effect.gen(function*() {
      const attempt = yield* Effect.flatMap(PackRunner, (packRunner) => packRunner.pack('attw-never-packs')).pipe(
        Effect.result,
        Effect.scoped,
      )
      expect(packOutcomeOf(attempt)).toEqual({ tag: 'PackRunnerSpawnRefused', timedOut: true })
    }).pipe(Effect.provide(packRunnerLayer)))
})
