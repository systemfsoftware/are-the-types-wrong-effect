import type { CompiledPackage, ResolvedModuleView } from '../compiled-package.handle.js'
import type { ModuleKind, ResolutionKind, ResolutionOption } from '../Problem.schema.js'

/** @internal */
export interface ObservationQuery {
  readonly self: CompiledPackage
  readonly entrypoint: string
  readonly resolutionKind: ResolutionKind
  readonly resolutionOption: ResolutionOption
  readonly fileName: string | undefined
  readonly node16ModuleKinds?: Record<string, ModuleKind> | undefined
}

/** @internal */
export const isNonEmptyText = (value: string | undefined): value is string => value !== undefined && value !== ''

/** @internal */
export const viewFileName = (view: ResolvedModuleView | undefined): string | undefined => view?.fileName

/** @internal */
export const nullOrText = (value: string | undefined): string | null => value ?? null

/** @internal */
export const nullOrModuleKind = (value: ModuleKind | undefined): ModuleKind | null => value ?? null
