import { Cell } from '@systemfsoftware/effect-cell-types'
import { Effect } from 'effect'

import type { CompilerFailed, LexerUnavailable } from './AnalysisError.schema.js'
import type { CompiledPackage } from './compiled-package.handle.js'
import { open as openCompiledPackage } from './compiled-package.handle.js'
import type { PreparedPackage } from './open-package.cell.js'
import type { ResolutionKind } from './Problem.schema.js'
import type { PackageTypes } from './Report.schema.js'

export interface CompiledTarget {
  readonly compiled: CompiledPackage
  readonly packageName: string
  readonly packageVersion: string
  readonly entrypoints: ReadonlyArray<string>
  readonly types: PackageTypes
  readonly buildTools: Record<string, string>
  readonly modes: ReadonlyArray<ResolutionKind>
}

const targetOf = (prepared: PreparedPackage, compiled: CompiledPackage): CompiledTarget => ({
  compiled,
  packageName: prepared.packageName,
  packageVersion: prepared.packageVersion,
  entrypoints: prepared.entrypoints,
  types: prepared.types,
  buildTools: prepared.buildTools,
  modes: prepared.modes,
})

export const compilePackage: Cell.Cell<PreparedPackage, CompiledTarget, CompilerFailed | LexerUnavailable> = Cell.id<
  PreparedPackage
>().pipe(
  Cell.flatMap((prepared) =>
    Cell.fromEffect(Effect.map(openCompiledPackage(prepared.pkg), (compiled) => targetOf(prepared, compiled)))
  ),
)
