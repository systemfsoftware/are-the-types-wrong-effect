import { Context, Effect } from 'effect'
import type * as Scope from 'effect/Scope'
import type { PackRunnerOutputUnreadable, PackRunnerSpawnRefused } from './PackRunnerError.schema.js'

export interface PackResult {
  readonly tarballName: string
  readonly tarballPath: string
}

export interface PackRunnerService {
  readonly pack: (
    directory: string,
  ) => Effect.Effect<PackResult, PackRunnerSpawnRefused | PackRunnerOutputUnreadable, Scope.Scope>
}
export class PackRunner extends Context.Service<PackRunner, PackRunnerService>()(
  '@systemfsoftware/arethetypeswrong-cli/pack-runner.service/PackRunner',
) {}
