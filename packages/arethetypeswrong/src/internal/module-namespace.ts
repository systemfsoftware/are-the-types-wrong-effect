import './typescript-internals.js'
import * as cjs from '@loaderkit/resolve/cjs'
import * as esm from '@loaderkit/resolve/esm'
import type { FileSystemSync } from '@loaderkit/resolve/fs'
import type { Package } from '@systemfsoftware/npm-package'
import type { Exports } from 'cjs-module-lexer'
import { parse as cjsParse } from 'cjs-module-lexer'
import { Option, Result, Schema } from 'effect'
import ts from 'typescript'
import { JsonDocument } from './json-document.schema.js'
import { hasDefaultModifier, hasExportModifier } from './typescript-nodes.js'

type ParsedJsonDocument = Schema.Schema.Type<typeof JsonDocument>

const noBindings: Exports = { exports: [], reexports: [] }
const defaultOnlyBindings: Exports = { exports: ['default'], reexports: [] }

const jsonText = (pkg: Package) => (url: URL): ParsedJsonDocument | undefined =>
  Option.getOrUndefined(Option.liftThrowable(decodeJson)(pkg.readFile(url.pathname)))

const decodeJson = (text: string): ParsedJsonDocument => Result.getOrThrow(Schema.decodeResult(JsonDocument)(text))

const fileSystemAdapter = (pkg: Package): FileSystemSync => ({
  directoryExists: (url) => pkg.directoryExists(url.pathname),
  fileExists: (url) => pkg.fileExists(url.pathname),
  readFileJSON: jsonText(pkg),
  readLink: () => undefined,
})

interface ResolveQuery {
  readonly pkg: Package
  readonly specifier: string
  readonly parentURL: URL
}

const resolveAsCommonJsOption = (query: ResolveQuery): Option.Option<esm.Resolution> =>
  Option.liftThrowable(cjs.resolveSync)(fileSystemAdapter(query.pkg), query.specifier, query.parentURL)

const resolveAsEsmOption = (query: ResolveQuery): Option.Option<esm.Resolution> =>
  Option.liftThrowable(esm.resolveSync)(fileSystemAdapter(query.pkg), query.specifier, query.parentURL)

/** @internal */
export const getCjsModuleBindings = (sourceText: string): Exports => cjsParse(sourceText)

/** @internal */
export const getEsmModuleBindings = (sourceText: string): Exports => {
  const collected = parsedStatementBindings(sourceText)
  return {
    exports: collected.flatMap((bindings) => bindings.exports),
    reexports: collected.flatMap((bindings) => bindings.reexports),
  }
}

const parsedStatementBindings = (sourceText: string): readonly Exports[] => {
  const options: ts.CreateSourceFileOptions = {
    languageVersion: ts.ScriptTarget.ESNext,
    impliedNodeFormat: ts.ModuleKind.ESNext,
  }
  const sourceFile = ts.createSourceFile('module.cjs', sourceText, options, false, ts.ScriptKind.JS)
  return sourceFile.statements.map(statementBindings)
}

const statementBindings = (statement: ts.Statement): Exports => statementBindingsOf(statement) ?? noBindings

const statementBindingsOf = (statement: ts.Statement): Exports | undefined => {
  if (ts.isExportDeclaration(statement)) {
    return exportDeclarationBindings(statement)
  }
  return nonExportDeclarationBindings(statement)
}

const nonExportDeclarationBindings = (statement: ts.Statement): Exports | undefined => {
  if (ts.isExportAssignment(statement)) {
    return exportAssignmentBindings(statement)
  }
  return declaredStatementBindings(statement)
}

const declaredStatementBindings = (statement: ts.Statement): Exports | undefined => {
  if (ts.isVariableStatement(statement)) {
    return variableStatementBindings(statement)
  }
  return classOrFunctionBindings(statement)
}

const exportDeclarationBindings = (declaration: ts.ExportDeclaration): Exports => {
  if (declaration.isTypeOnly) {
    return noBindings
  }
  return exportClauseBindings(declaration)
}

const exportClauseBindings = (declaration: ts.ExportDeclaration): Exports => {
  if (declaration.exportClause === undefined) {
    return reexportSpecifierBindings(declaration.moduleSpecifier)
  }
  return namedExportBindings(declaration.exportClause)
}

const reexportSpecifierBindings = (moduleSpecifier: ts.Expression | undefined): Exports =>
  Option.match(Option.fromNullishOr(moduleSpecifier), {
    onNone: () => noBindings,
    onSome: (specifier) => stringReexportOf(specifier),
  })

const stringReexportOf = (specifier: ts.Expression): Exports => {
  if (!ts.isStringLiteral(specifier)) {
    return noBindings
  }
  return { exports: [], reexports: [specifier.text] }
}

const namedExportBindings = (bindings: ts.NamedExportBindings): Exports => {
  if (ts.isNamedExports(bindings)) {
    return { exports: namedExportNames(bindings), reexports: [] }
  }
  return { exports: [bindings.name.text], reexports: [] }
}

const namedExportNames = (bindings: ts.NamedExports): string[] =>
  bindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text)

const exportAssignmentBindings = (statement: ts.ExportAssignment): Exports => {
  if (statement.isExportEquals === true) {
    return noBindings
  }
  return { exports: ['default'], reexports: [] }
}

const classOrFunctionBindings = (statement: ts.Statement): Exports => {
  if (!isClassOrFunctionDeclaration(statement)) {
    return noBindings
  }
  return exportedClassOrFunctionBindings(statement)
}

const isClassOrFunctionDeclaration = (
  statement: ts.Statement,
): statement is ts.ClassDeclaration | ts.FunctionDeclaration =>
  ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)

const exportedClassOrFunctionBindings = (declaration: ts.ClassDeclaration | ts.FunctionDeclaration): Exports => {
  if (!hasExportModifier(declaration)) {
    return noBindings
  }
  return defaultOrNamedBindings(declaration)
}

const defaultOrNamedBindings = (declaration: ts.ClassDeclaration | ts.FunctionDeclaration): Exports => {
  if (hasDefaultModifier(declaration)) {
    return { exports: ['default'], reexports: [] }
  }
  return namedDeclarationBindings(declaration)
}

const namedDeclarationBindings = (declaration: ts.ClassDeclaration | ts.FunctionDeclaration): Exports =>
  Option.match(Option.fromNullishOr(declaration.name), {
    onNone: () => noBindings,
    onSome: (name) => ({ exports: [name.text], reexports: [] }),
  })

const variableStatementBindings = (statement: ts.VariableStatement): Exports => {
  if (!hasExportModifier(statement)) {
    return noBindings
  }
  return { exports: declaredNames(statement.declarationList.declarations), reexports: [] }
}

const declaredNames = (declarations: readonly ts.VariableDeclaration[]): string[] =>
  declarations.flatMap((declaration) => destructuredNames(declaration.name))

const destructuredNames = (node: ts.BindingName): readonly string[] => {
  if (ts.isIdentifier(node)) {
    return [node.text]
  }
  return patternElementNames(node.elements)
}

const patternElementNames = (elements: readonly ts.ArrayBindingElement[]): readonly string[] =>
  elements.filter(ts.isBindingElement).flatMap((element) => destructuredNames(element.name))

/** @internal */
export const getEsmModuleNamespace = (query: {
  readonly pkg: Package
  readonly specifier: string
  readonly parentURL?: URL
  readonly seen?: ReadonlySet<string>
}): readonly string[] => namespaceFrom(query.pkg, query.specifier, namespaceRootOf(query), new Set(query.seen ?? []))

const namespaceRootOf = (query: {
  readonly parentURL?: URL
}): URL => query.parentURL ?? new URL('file:///')

const namespaceFrom = (
  pkg: Package,
  specifier: string,
  parentURL: URL,
  seen: Set<string>,
): readonly string[] =>
  Option.match(resolveAsEsmOption({ pkg, specifier, parentURL }), {
    onNone: () => [],
    onSome: (resolved) => visitedModuleNamespace(pkg, resolved, seen),
  })

const visitedModuleNamespace = (
  pkg: Package,
  resolved: esm.Resolution,
  seen: Set<string>,
): readonly string[] => {
  if (seen.has(resolved.url.pathname)) {
    return []
  }
  return resolvedModuleNamespace(pkg, resolved, seen)
}

const resolvedModuleNamespace = (
  pkg: Package,
  resolved: esm.Resolution,
  seen: Set<string>,
): readonly string[] => {
  seen.add(resolved.url.pathname)
  if (resolved.format === 'commonjs') {
    return [...cjsModuleNamespace(pkg, resolved.url, new Set())]
  }
  return esmModuleNamespace(pkg, resolved, seen)
}

const esmModuleNamespace = (
  pkg: Package,
  resolved: esm.Resolution,
  seen: Set<string>,
): readonly string[] => {
  const bindings = moduleBindings(pkg, resolved, resolved.format)
  const indirect = bindings.reexports
    .flatMap((specifier) => namespaceFrom(pkg, specifier, resolved.url, seen))
    .filter((name) => name !== 'default')
  return [...new Set([...bindings.exports, ...indirect])]
}

const moduleBindings = (pkg: Package, resolved: esm.Resolution, format: esm.ModuleFormat | undefined): Exports => {
  if (!isEsmModuleFormat(format)) {
    return defaultOnlyBindings
  }
  return getEsmModuleBindings(pkg.readFile(resolved.url.pathname))
}

const isEsmModuleFormat = (format: esm.ModuleFormat | undefined): boolean => (format ?? 'module') === 'module'

const cjsModuleNamespace = (pkg: Package, file: URL, seen: Set<string>): Set<string> => {
  seen.add(file.pathname)
  const bindings = getCjsModuleBindings(pkg.readFile(file.pathname))
  const reexported = [...bindings.reexports].reverse().flatMap((source) => [
    ...reexportedNames(pkg, source, file, seen),
  ])
  return new Set<string>([...bindings.exports, 'default', ...reexported])
}

const reexportedNames = (pkg: Package, source: string, file: URL, seen: Set<string>): ReadonlySet<string> =>
  Option.match(resolveAsCommonJsOption({ pkg, specifier: source, parentURL: file }), {
    onNone: () => new Set<string>(),
    onSome: (resolved) => unseenCommonJsNames(pkg, resolved, file, seen),
  })

const unseenCommonJsNames = (
  pkg: Package,
  resolved: esm.Resolution,
  file: URL,
  seen: Set<string>,
): ReadonlySet<string> =>
  Option.match(reexportTarget(resolved, seen), {
    onNone: () => new Set<string>(),
    onSome: (target) => cjsModuleNamespace(pkg, target, seen),
  })

const reexportTarget = (resolved: esm.Resolution, seen: Set<string>): Option.Option<URL> =>
  Option.filter(Option.some(resolved.url), (url) => resolved.format === 'commonjs' && !seen.has(url.pathname))
