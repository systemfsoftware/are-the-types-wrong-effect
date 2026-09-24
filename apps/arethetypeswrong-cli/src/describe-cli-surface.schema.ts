import { Schema } from 'effect'

import { documentedEnvelopeKeys, documentedFlags } from './describe-cli-surface.command.js'
import { analyzeFlags } from './run-attw.command.js'

const implementedFlags: readonly string[] = Object.keys(analyzeFlags)

const constantOrFallback = (values: readonly string[], fallback: string): Schema.Schema<string> =>
  Schema.Literals(values.length > 0 ? values : [fallback])

export const implementedFlag: Schema.Schema<string> = constantOrFallback(implementedFlags, '__no_implemented_flags__')

export const documentedFlag: Schema.Schema<string> = constantOrFallback(documentedFlags, '__no_documented_flags__')

export const documentedEnvelopeKey: Schema.Schema<string> = constantOrFallback(
  documentedEnvelopeKeys,
  '__no_documented_envelope_keys__',
)
