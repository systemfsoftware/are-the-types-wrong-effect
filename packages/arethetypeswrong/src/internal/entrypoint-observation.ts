import type { CompiledPackage, ResolvedModuleView } from '../compiled-package.handle.js'
import type { ModuleKind, ResolutionKind } from '../Problem.schema.js'

/** @internal */
export interface ObservationQuery {
  readonly self: CompiledPackage
  readonly entrypoint: string
  readonly resolutionKind: ResolutionKind
}

/** @internal */
export const isNonEmptyText = (value: string | undefined): value is string => value !== undefined && value !== ''

/** @internal */
export const viewFileName = (view: ResolvedModuleView | undefined): string | undefined => view?.fileName

/** @internal */
export const nullOrText = (value: string | undefined): string | null => value ?? null

/** @internal */
export const nullOrModuleKind = (value: ModuleKind | undefined): ModuleKind | null => value ?? null
