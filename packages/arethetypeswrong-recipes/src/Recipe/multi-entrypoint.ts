import { createPackage } from '@systemfsoftware/npm-package'
import { manifestText } from './manifest.js'

export const MultiEntrypoint = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'multi-entrypoint',
        version: '1.0.0',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            default: './dist/index.js',
          },
          './macros': {
            types: './dist/macros.d.ts',
            default: './dist/macros.js',
          },
          './utils': {
            types: './dist/utils.d.ts',
            default: './dist/utils.js',
          },
        },
      }),
      'dist/index.js': 'module.exports = { a: 1 };\n',
      'dist/index.d.ts': 'export declare const a: number;\n',
      'dist/macros.js': 'module.exports = { m: 1 };\n',
      'dist/macros.d.ts': 'export declare const m: number;\n',
      'dist/utils.js': 'module.exports = { u: 1 };\n',
      'dist/utils.d.ts': 'export declare const u: number;\n',
    },
    'multi-entrypoint',
    '1.0.0',
  )
