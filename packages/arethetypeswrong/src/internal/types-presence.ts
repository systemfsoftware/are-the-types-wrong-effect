import './typescript-internals.js'
import type { Package } from '@systemfsoftware/npm-package'
import ts from 'typescript'

/** @internal */
export const containsTypes = (pkg: Package): boolean =>
  pkg.listFiles('/').some((fileName) => ts.hasTSFileExtension(fileName))
