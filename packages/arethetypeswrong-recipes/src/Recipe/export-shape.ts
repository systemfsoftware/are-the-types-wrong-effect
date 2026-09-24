import { createPackage } from '@systemfsoftware/npm-package'
import { manifestText } from './manifest.js'

export const NamedExports = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'named-exports',
        version: '1.0.0',
        main: './dist/index.cjs',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
            require: './dist/index.cjs',
          },
        },
      }),
      'dist/index.d.ts':
        'export declare const a: string;\nexport declare const b: string;\nexport declare const c: string;\n',
      'dist/index.cjs': 'module.exports = { a: "a", b: "b", c: "c" };\n',
      'dist/index.js': 'module.exports = { a: "a" };\n',
    },
    'named-exports',
    '1.0.0',
  )

export const FalseExportDefault = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'false-export-default',
        version: '1.0.0',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': './dist/index.js',
        },
      }),
      'dist/index.d.ts': 'declare const foo: string;\nexport default foo;\n',
      'dist/index.js': 'module.exports = { notDefault: 1 };\n',
    },
    'false-export-default',
    '1.0.0',
  )

export const MissingExportEquals = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'missing-export-equals',
        version: '1.0.0',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': './dist/index.js',
        },
      }),
      'dist/index.d.ts': 'declare function foo(): void;\nexport default foo;\n',
      'dist/index.js': 'function foo() {}\nmodule.exports = foo;\nmodule.exports.default = foo;\n',
    },
    'missing-export-equals',
    '1.0.0',
  )
