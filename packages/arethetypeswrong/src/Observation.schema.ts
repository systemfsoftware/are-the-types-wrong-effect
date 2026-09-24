import { Schema } from 'effect'

import {
  ModuleKindSchema,
  ModuleKindSyntaxSchema,
  ResolutionKindSchema,
  ResolutionOptionSchema,
} from './Problem.schema.js'

export const EntrypointPath = Schema.NonEmptyString
export type EntrypointPath = Schema.Schema.Type<typeof EntrypointPath>

export const ResolvedFileName = Schema.NonEmptyString
export type ResolvedFileName = Schema.Schema.Type<typeof ResolvedFileName>

export const ModuleSpecifier = Schema.NonEmptyString
export type ModuleSpecifier = Schema.Schema.Type<typeof ModuleSpecifier>

export const SourceOffset = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
export type SourceOffset = Schema.Schema.Type<typeof SourceOffset>

export const ResolvedModule = Schema.Struct({
  fileName: ResolvedFileName,
  isTypeScript: Schema.Boolean,
  isJson: Schema.Boolean,
})
export type ResolvedModule = Schema.Schema.Type<typeof ResolvedModule>

export const ResolutionObservation = Schema.Struct({
  entrypoint: EntrypointPath,
  resolutionKind: ResolutionKindSchema,
  isWildcard: Schema.Boolean,
  typesResolution: Schema.NullOr(ResolvedModule),
  implementationResolution: Schema.NullOr(ResolvedModule),
  node16ModuleKind: Schema.NullOr(ModuleKindSchema),
})
export type ResolutionObservation = Schema.Schema.Type<typeof ResolutionObservation>

export const NamedExportsObservation = Schema.Struct({
  resolutionKind: ResolutionKindSchema,
  typesFileName: Schema.NullOr(ResolvedFileName),
  implementationFileName: Schema.NullOr(ResolvedFileName),
  typesModuleKind: Schema.NullOr(ModuleKindSchema),
  implementationModuleKind: Schema.NullOr(ModuleKindSchema),
  typesIsArrayLikeModule: Schema.NullOr(Schema.Boolean),
  typesValueExportNames: Schema.NullOr(Schema.Array(Schema.String)),
  implementationExportNames: Schema.NullOr(Schema.Array(Schema.String)),
})
export type NamedExportsObservation = Schema.Schema.Type<typeof NamedExportsObservation>

export const TypesDefaultFacts = Schema.Struct({
  hasDefaultExportSymbol: Schema.Boolean,
  hasDefaultSymbol: Schema.Boolean,
  hasExportEquals: Schema.Boolean,
  hasNonDefaultValueExport: Schema.Boolean,
  defaultTypeIsObject: Schema.Boolean,
  defaultTypeHasCallOrConstructSignatures: Schema.Boolean,
})
export type TypesDefaultFacts = Schema.Schema.Type<typeof TypesDefaultFacts>

export const ImplementationDefaultFacts = Schema.Struct({
  hasDefault: Schema.Boolean,
  exportEqualsSharesContainer: Schema.Boolean,
  exportsAreAnalyzable: Schema.Boolean,
  hasExportEquals: Schema.Boolean,
  exportEqualsIsExportDefault: Schema.Boolean,
  moduleExportsTypeHasCallOrConstructSignatures: Schema.Boolean,
  hasNonDefaultExport: Schema.Boolean,
})
export type ImplementationDefaultFacts = Schema.Schema.Type<typeof ImplementationDefaultFacts>

export const ExportDefaultDisagreementObservation = Schema.Struct({
  typesFileName: Schema.NullOr(ResolvedFileName),
  implementationFileName: Schema.NullOr(ResolvedFileName),
  resolutionKind: ResolutionKindSchema,
  typesModuleKind: Schema.NullOr(ModuleKindSchema),
  implementationModuleKind: Schema.NullOr(ModuleKindSchema),
  types: TypesDefaultFacts,
  implementation: ImplementationDefaultFacts,
})
export type ExportDefaultDisagreementObservation = Schema.Schema.Type<typeof ExportDefaultDisagreementObservation>

export const InternalResolutionErrorObservation = Schema.Struct({
  resolutionOption: ResolutionOptionSchema,
  fileName: ResolvedFileName,
  moduleSpecifier: ModuleSpecifier,
  pos: SourceOffset,
  end: SourceOffset,
  resolutionMode: Schema.NullOr(Schema.Int),
  trace: Schema.Array(Schema.String),
})
export type InternalResolutionErrorObservation = Schema.Schema.Type<typeof InternalResolutionErrorObservation>

export const UnexpectedModuleSyntaxObservation = Schema.Struct({
  fileName: ResolvedFileName,
  expectedModuleKind: ModuleKindSchema,
  impliedSyntax: Schema.NullOr(ModuleKindSyntaxSchema),
  pos: Schema.NullOr(SourceOffset),
  end: Schema.NullOr(SourceOffset),
})
export type UnexpectedModuleSyntaxObservation = Schema.Schema.Type<typeof UnexpectedModuleSyntaxObservation>

export const CJSOnlyExportsDefaultObservation = Schema.Struct({
  resolutionKind: ResolutionKindSchema,
  implementationFileName: ResolvedFileName,
  isCommonJsOnlyFile: Schema.Boolean,
  hasDefaultAndEsModuleMarkers: Schema.Boolean,
  hasExportEquals: Schema.Boolean,
  defaultDeclarationStart: Schema.NullOr(SourceOffset),
  defaultDeclarationEnd: Schema.NullOr(SourceOffset),
})
export type CJSOnlyExportsDefaultObservation = Schema.Schema.Type<typeof CJSOnlyExportsDefaultObservation>
