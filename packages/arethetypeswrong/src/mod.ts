export * as Analysis from './Analysis/mod.js'

export {
  AnalysisSchema,
  AnalysisTypesSchema,
  BuildToolSchema,
  CheckResultSchema,
  IncludedTypesSchema,
  TypesPackageSchema,
  UntypedResultSchema,
} from './Analysis.schema.js'
export type { CheckResult, LegacyAnalysis, UntypedResult } from './Analysis.schema.js'
export type { BuildTool } from './Analysis.schema.js'

export {
  PackageNotFoundError,
  PackageStore,
  PackageStoreError,
  PackageStoreLive,
  PackageStoreStub,
} from './PackageStoreAdapter.js'
export type { PackageStoreOptions, PackageStoreService, PackageStoreTarballRef } from './PackageStoreAdapter.js'

export { checkPackage } from './CheckPackage.js'
export type { CheckPackageOptions } from './CheckPackage.js'

export { CheckPackage, CheckPackageLive } from './CheckPackageExecutor.js'
export type { CheckPackageService } from './CheckPackageExecutor.js'

export {
  detectFallbackCondition,
  DetectFallbackConditionCommand,
  FallbackConditionAbsent,
  type FallbackConditionDecision,
  FallbackConditionDetected,
  type FallbackTraceObservation,
  ResolutionTracesCollected,
  ResolutionTracesUnavailable,
  ResolutionTraceUnavailable,
} from './detect-fallback-condition.workflow.js'

export { CommonJSModuleKind, ESNextModuleKind } from './ModuleKind.js'

export {
  detectModuleKindDisagreement,
  DetectModuleKindDisagreementCommand,
  FalseCjsDeclared,
  FalseEsmDeclared,
  type ModuleKindDisagreementDecision,
  ModuleKindObservationComplete,
  ModuleKindObservationMissing,
  ModuleKindObservationUnavailable,
  ModuleKindsAgree,
} from './detect-module-kind-disagreement.workflow.js'

export { parsePackageSpec } from './PackageSpec.js'

export { PackageSpecParseError, PackageSpecVersionKindSchema, ParsedPackageSpecSchema } from './PackageSpec.schema.js'
export type { PackageSpecVersionKind, ParsedPackageSpec } from './PackageSpec.schema.js'

export {
  CJSOnlyExportsDefaultProblemSchema,
  CJSResolvesToESMProblemSchema,
  EntrypointResolutionAnalysisSchema,
  FallbackConditionProblemSchema,
  FalseCJSProblemSchema,
  FalseESMProblemSchema,
  FalseExportDefaultProblemSchema,
  InternalResolutionErrorProblemSchema,
  MissingExportEqualsProblemSchema,
  ModuleKindReasonSchema,
  ModuleKindSchema,
  ModuleKindSyntaxSchema,
  NamedExportsProblemSchema,
  NoResolutionProblemSchema,
  ProblemKindSchema,
  ProblemSchema,
  ResolutionKindSchema,
  ResolutionOptionSchema,
  ResolutionSchema,
  UnexpectedModuleSyntaxProblemSchema,
  UntypedResolutionProblemSchema,
} from './Problem.schema.js'
export type {
  CJSOnlyExportsDefaultProblem,
  CJSResolvesToESMProblem,
  EntrypointResolutionAnalysis,
  FallbackConditionProblem,
  FalseCJSProblem,
  FalseESMProblem,
  FalseExportDefaultProblem,
  InternalResolutionErrorProblem,
  MissingExportEqualsProblem,
  ModuleKind,
  ModuleKindReason,
  ModuleKindSyntax,
  NamedExportsProblem,
  NoResolutionProblem,
  Problem,
  ProblemKind,
  Resolution,
  ResolutionKind,
  ResolutionOption,
  UnexpectedModuleSyntaxProblem,
  UntypedResolutionProblem,
} from './Problem.schema.js'

export { EntrypointInfoSchema, ProgramInfoSchema } from './Resolution.schema.js'
export type { EntrypointInfo, ProgramInfo } from './Resolution.schema.js'

export { containsTypes, withTypesCompanion } from './TypesCompanion.js'
export type { PackageWithCompanion, TypesCompanionInfo } from './TypesCompanion.js'
