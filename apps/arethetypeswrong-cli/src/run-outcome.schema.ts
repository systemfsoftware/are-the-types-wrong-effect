import { Analysis } from '@systemfsoftware/arethetypeswrong'
import * as S from 'effect/Schema'

import { MachineEnvelopeSchema } from './decode-envelope-document.workflow.js'
import { AttwFailureSchema } from './Failure.schema.js'

export const RenderModeSchema = S.Literals(['envelope', 'table', 'table-flipped', 'ascii', 'quiet'])

export type RenderMode = S.Schema.Type<typeof RenderModeSchema>

export const EnvelopeMaskSchema = S.Struct({
  entrypoints: S.Boolean,
  buildTools: S.Boolean,
  programInfo: S.Boolean,
  traces: S.Boolean,
})

export type EnvelopeMask = S.Schema.Type<typeof EnvelopeMaskSchema>

export class AnalyzedRun extends S.TaggedClass<AnalyzedRun>()('AnalyzedRun', {
  result: Analysis.PackageReport,
  format: S.String,
  quiet: S.Boolean,
  color: S.Boolean,
  summary: S.Boolean,
  emoji: S.Boolean,
  ignoreRules: S.Array(S.String),
  ignoreResolutions: S.Array(S.String),
  include: S.Array(S.String),
  mask: EnvelopeMaskSchema,
}) {}

export class RenderedRun extends S.TaggedClass<RenderedRun>()('RenderedRun', {
  result: Analysis.PackageReport,
  format: S.String,
  quiet: S.Boolean,
  color: S.Boolean,
  summary: S.Boolean,
  emoji: S.Boolean,
  ignoreRules: S.Array(S.String),
  ignoreResolutions: S.Array(S.String),
  include: S.Array(S.String),
  mask: EnvelopeMaskSchema,
  mode: RenderModeSchema,
  document: MachineEnvelopeSchema,
}) {}

export class RefusedRun extends S.TaggedClass<RefusedRun>()('RefusedRun', {
  failure: AttwFailureSchema,
}) {}

export const RunOutcome = S.Union([AnalyzedRun, RefusedRun])
export type RunOutcome = S.Schema.Type<typeof RunOutcome>

export const RenderOutcome = S.Union([RenderedRun, RefusedRun])
export type RenderOutcome = S.Schema.Type<typeof RenderOutcome>
