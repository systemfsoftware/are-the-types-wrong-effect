import { createPackage } from '@systemfsoftware/npm-package'
import ts from 'typescript'
import { expect, it } from 'vitest'

const pkg = createPackage(
  {
    'package.json': JSON.stringify({
      name: 'resolution-fixture',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': {
          import: './dist/index.mjs',
          require: './dist/index.cjs',
        },
      },
    }),
    'dist/index.mjs': 'export const value = 1;\n',
    'dist/index.cjs': 'module.exports = { value: 1 };\n',
    'dist/index.d.mts': 'export declare const value: number;\n',
    'dist/index.d.cts': 'export declare const value: number;\n',
  },
  'resolution-fixture',
  '1.0.0',
)

const canonicalFileName = (fileName: string): string => fileName

const sourceFileOf = (fileName: string): ts.SourceFile | undefined => {
  const text = pkg.tryReadFile(fileName)
  if (text === undefined) {
    return undefined
  }
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest)
}

const minimalHost = (): ts.CompilerHost => ({
  fileExists: (fileName) => pkg.fileExists(fileName),
  readFile: (fileName) => pkg.readFile(fileName),
  directoryExists: (directoryName) => pkg.directoryExists(directoryName),
  getSourceFile: (fileName) => sourceFileOf(fileName),
  getDefaultLibFileName: () => '',
  writeFile: () => {
    throw new Error('not used in resolution')
  },
  getCanonicalFileName: canonicalFileName,
  useCaseSensitiveFileNames: () => false,
  getCurrentDirectory: () => '/',
  getNewLine: () => '\n',
})

const resolveEntry = (
  moduleResolution: ts.ModuleResolutionKind,
  moduleKind: ts.ModuleKind,
  resolutionMode: ts.ResolutionMode,
): string | undefined => {
  const options: ts.CompilerOptions = {
    moduleResolution,
    module: moduleKind,
    moduleDetection: ts.ModuleDetectionKind.Legacy,
    target: ts.ScriptTarget.Latest,
    resolveJsonModule: true,
  }
  const resolution = ts.resolveModuleName(
    'resolution-fixture',
    '/importer.ts',
    options,
    minimalHost(),
    undefined,
    undefined,
    resolutionMode,
  )
  return resolution.resolvedModule?.resolvedFileName
}

it('node16 with an ESM importer condition resolves the esm declaration', () => {
  expect(resolveEntry(ts.ModuleResolutionKind.Node16, ts.ModuleKind.Node16, ts.ModuleKind.ESNext)).toBe(
    '/node_modules/resolution-fixture/dist/index.d.mts',
  )
})

it('node16 with a CJS importer condition resolves the cjs declaration', () => {
  expect(resolveEntry(ts.ModuleResolutionKind.Node16, ts.ModuleKind.Node16, ts.ModuleKind.CommonJS)).toBe(
    '/node_modules/resolution-fixture/dist/index.d.cts',
  )
})

it('bundler resolution honors the import condition like node16 ESM', () => {
  expect(resolveEntry(ts.ModuleResolutionKind.Bundler, ts.ModuleKind.ESNext, ts.ModuleKind.ESNext)).toBe(
    '/node_modules/resolution-fixture/dist/index.d.mts',
  )
})

it('node10 resolution probes declarations rather than honoring exports conditions', () => {
  expect(resolveEntry(ts.ModuleResolutionKind.Node10, ts.ModuleKind.CommonJS, ts.ModuleKind.CommonJS)).toBe(
    '/node_modules/resolution-fixture/dist/index.d.cts',
  )
})

it('the node16 require and import targets are different declaration files', () => {
  const requireTarget = resolveEntry(ts.ModuleResolutionKind.Node16, ts.ModuleKind.Node16, ts.ModuleKind.CommonJS)
  const importTarget = resolveEntry(ts.ModuleResolutionKind.Node16, ts.ModuleKind.Node16, ts.ModuleKind.ESNext)
  expect(requireTarget).not.toBe(importTarget)
  expect(requireTarget).toContain('index.d.cts')
  expect(importTarget).toContain('index.d.mts')
})
