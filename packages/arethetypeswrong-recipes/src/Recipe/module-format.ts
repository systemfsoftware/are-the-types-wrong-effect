import { createPackage } from '@systemfsoftware/npm-package'
import { manifestText } from './manifest.js'

export const FalseCJS = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'false-cjs',
        version: '1.0.0',
        main: './dist/index.cjs',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.mjs',
            require: './dist/index.cjs',
          },
        },
      }),
      'dist/index.d.ts': 'export declare const foo: string;\n',
      'dist/index.cjs': 'module.exports = { foo: "bar" };\nmodule.exports.foo = "bar";\n',
      'dist/index.mjs': 'export const foo = "bar";\nexport default {};\n',
    },
    'false-cjs',
    '1.0.0',
  )

export const FalseESM = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'false-esm',
        version: '1.0.0',
        type: 'module',
        main: './dist/index.mjs',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.mjs',
            require: './dist/index.cjs',
          },
        },
      }),
      'dist/index.d.ts': 'export declare const foo: string;\n',
      'dist/index.cjs': '"use strict";\nmodule.exports = { foo: "bar" };\n',
      'dist/index.mjs': 'export const foo = "bar";\n',
    },
    'false-esm',
    '1.0.0',
  )

export const CJSOnlyExportsDefault = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'cjs-only-exports-default',
        version: '1.0.0',
        type: 'module',
        main: './dist/require.cjs',
        types: './dist/index.d.cts',
        exports: {
          '.': {
            types: './dist/index.d.cts',
            import: './dist/import.cjs',
            require: './dist/require.cjs',
          },
        },
      }),
      'dist/import.cjs':
        '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.default = 42;\n',
      'dist/require.cjs': 'module.exports = { foo: 1 };\n',
      'dist/index.d.cts': 'export {};\n',
    },
    'cjs-only-exports-default',
    '1.0.0',
  )

export const UnexpectedModuleSyntax = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'unexpected-module-syntax',
        version: '1.0.0',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': './dist/index.js',
        },
      }),
      'dist/index.js': 'export const foo = 1;\n',
      'dist/index.d.ts': 'export declare const foo: number;\n',
    },
    'unexpected-module-syntax',
    '1.0.0',
  )
