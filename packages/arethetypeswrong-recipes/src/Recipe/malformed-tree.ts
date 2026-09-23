import { createPackage } from '@systemfsoftware/npm-package'

export const KnownBad = () =>
  createPackage(
    {
      'package.json': '{"name":"known-bad","version":"1.0.0",}',
      'index.js': 'module.exports = {};\n',
      'index.d.ts': 'export {};\n',
    },
    'known-bad',
    '1.0.0',
  )
