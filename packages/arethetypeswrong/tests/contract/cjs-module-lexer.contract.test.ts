import { initSync, parse } from 'cjs-module-lexer'
import { expect, it } from 'vitest'

it('initSync prepares the lexer for parsing', () => {
  initSync()
  expect(parse('module.exports = {}')).toEqual({ exports: [], reexports: [] })
})

it('exports.foo assignments are reported as named exports', () => {
  const parsed = parse('exports.alpha = 1;\nexports.beta = 2;\n')
  expect(parsed.exports).toEqual(['alpha', 'beta'])
  expect(parsed.reexports).toEqual([])
})

it('shorthand module.exports object literals report their keys as named exports', () => {
  const parsed = parse('const alpha = 1; const beta = 2;\nmodule.exports = { alpha, beta };\n')
  expect(parsed.exports).toEqual(['alpha', 'beta'])
})

it('module.exports object literals with non-shorthand values report nothing', () => {
  const parsed = parse('module.exports = { alpha: 1, beta: 2 };\n')
  expect(parsed.exports).toEqual([])
})

it('a require call on module.exports is reported as a reexport, not a named export', () => {
  const parsed = parse('module.exports = require("./other.js");\n')
  expect(parsed.reexports).toEqual(['./other.js'])
  expect(parsed.exports).toEqual([])
})

it('defineProperty on exports is reported as a named export', () => {
  const parsed = parse('Object.defineProperty(exports, "alpha", { value: 1 });\n')
  expect(parsed.exports).toEqual(['alpha'])
})

it('the esModule interop marker is reported as a plain named export', () => {
  const parsed = parse('exports.__esModule = true;\nexports.default = 1;\n')
  expect(parsed.exports).toEqual(['__esModule', 'default'])
})
