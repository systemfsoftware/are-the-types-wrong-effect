import { createPackage } from '@systemfsoftware/npm-package'
import { manifestText } from './manifest.js'

export const WellFormed = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'well-formed',
        version: '1.0.0',
        main: './dist/index.cjs',
        types: './dist/index.d.cts',
        exports: {
          '.': {
            import: './dist/index.mjs',
            require: './dist/index.cjs',
          },
        },
      }),
      'dist/index.d.mts': 'export declare const value: number;\n',
      'dist/index.mjs': 'export const value = 1;\n',
      'dist/index.d.cts': 'export declare const value: number;\n',
      'dist/index.cjs': 'module.exports = { value: 1 };\n',
    },
    'well-formed',
    '1.0.0',
  )
