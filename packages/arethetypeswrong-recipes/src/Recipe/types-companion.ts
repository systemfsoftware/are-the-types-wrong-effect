import { createPackage } from '@systemfsoftware/npm-package'
import { manifestText } from './manifest.js'

export const TypesCompanion = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: 'types-companion',
        version: '1.0.0',
        main: './dist/index.js',
      }),
      'dist/index.js': 'module.exports = { foo: "bar" };\n',
    },
    'types-companion',
    '1.0.0',
  )

export const TypesCompanionTypes = () =>
  createPackage(
    {
      'package.json': manifestText({
        name: '@types/types-companion',
        version: '1.0.0',
      }),
      'index.d.ts': 'declare module "types-companion" { export const foo: string; }\n',
    },
    '@types/types-companion',
    '1.0.0',
  )
