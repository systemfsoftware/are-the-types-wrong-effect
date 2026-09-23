import { createPackage } from '@systemfsoftware/npm-package'
import { manifestText } from './manifest.js'

export const CJSResolvesToESM = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'cjs-resolves-to-esm',
        version: '1.0.0',
        type: 'module',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': './dist/index.js',
        },
      }),
      'dist/index.js': 'export const x = 1;\n',
      'dist/index.d.ts': 'export declare const x: number;\n',
    },
    'cjs-resolves-to-esm',
    '1.0.0',
  )

export const FallbackCondition = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'fallback-condition',
        version: '1.0.0',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/missing.d.ts',
            default: './dist/index.js',
          },
        },
      }),
      'dist/index.js': 'module.exports = { x: 1 };\n',
      'dist/index.d.ts': 'export {};\n',
    },
    'fallback-condition',
    '1.0.0',
  )

export const InternalResolutionError = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'internal-resolution-error',
        version: '1.0.0',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': './dist/index.js',
        },
      }),
      'dist/index.d.ts': 'import { x } from "./does-not-exist.js";\nexport {};\n',
      'dist/index.js': 'module.exports = {};\n',
    },
    'internal-resolution-error',
    '1.0.0',
  )

export const NoResolution = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'no-resolution',
        version: '1.0.0',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': './dist/missing.js',
        },
      }),
      'dist/index.d.ts': 'export declare const x: number;\n',
      'dist/index.js': 'export const x = 1;\n',
    },
    'no-resolution',
    '1.0.0',
  )

export const UntypedResolution = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'untyped-resolution',
        version: '1.0.0',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': './dist/index.js',
        },
      }),
      'dist/index.js': 'module.exports = { x: 1 };\n',
      'other.d.ts': 'export declare const y: number;\n',
    },
    'untyped-resolution',
    '1.0.0',
  )
