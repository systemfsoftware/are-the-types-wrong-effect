import type * as ts from 'typescript'

declare module 'typescript' {
  /** @internal */
  export type GetCanonicalFileName = (fileName: string) => string
  /** @internal */
  export function createGetCanonicalFileName(useCaseSensitiveFileNames: boolean): ts.GetCanonicalFileName
  /** @internal */
  export function getAnyExtensionFromPath(path: string): string
  /** @internal */
  export function hasTSFileExtension(fileName: string): boolean
  /** @internal */
  export function hasJSFileExtension(fileName: string): boolean
  /** @internal */
  export function isDeclarationFileName(fileName: string): boolean
  /** @internal */
  export function bindSourceFile(file: ts.SourceFile, options: ts.CompilerOptions): void

  /** @internal */
  export function getTemporaryModuleResolutionState(
    packageJsonInfoCache: ts.PackageJsonInfoCache | undefined,
    host: ts.ModuleResolutionHost,
    options: ts.CompilerOptions,
  ): ts.ModuleResolutionState
  /** @internal */
  export function getPackageScopeForPath(
    directory: string,
    state: ts.ModuleResolutionState,
  ): ts.PackageJsonInfo | undefined
  /** @internal */
  export interface ModuleResolutionState {
    host: ts.ModuleResolutionHost
    compilerOptions: ts.CompilerOptions
    packageJsonInfoCache: ts.PackageJsonInfoCache | undefined
  }
  /** @internal */
  export interface PackageJsonInfo {
    packageDirectory: string
    contents: PackageJsonInfoContents
  }
  /** @internal */
  export interface PackageJsonInfoContents {
    packageJsonContent: {
      type?: string
    }
  }

  /** @internal */
  export interface SourceFile {
    symbol: ts.Symbol
    locals?: ts.SymbolTable
    imports?: readonly ts.StringLiteralLike[]
    externalModuleIndicator?: ts.Node | true
    commonJsModuleIndicator?: ts.Node
    path: ts.Path
    scriptKind: ts.ScriptKind
  }

  /** @internal */
  export interface TypeChecker {
    resolveExternalModuleSymbol(symbol: ts.Symbol): ts.Symbol
    getExportsAndPropertiesOfModule(moduleSymbol: ts.Symbol): ts.Symbol[]
    getSymbolFlags(symbol: ts.Symbol, excludeTypeOnlyMeanings: boolean): ts.SymbolFlags
  }

  /** @internal */
  export interface CompilerOptions {
    noDtsResolution?: boolean
  }
}
