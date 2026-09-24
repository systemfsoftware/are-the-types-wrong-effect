import { it } from '@effect/vitest'
import { Match, Option, Result, Schema } from 'effect'

import { cliVersion } from '../cli-version.js'
import {
  decodeEnvelopeDocument,
  EnvelopeDocumentCommand,
  type MachineEnvelope,
  MachineEnvelopeSchema,
} from '../decode-envelope-document.workflow.js'
import { buildSchemaDocument, documentedEnvelopeKeys, documentedFlags } from '../describe-cli-surface.command.js'
import { documentedEnvelopeKey, documentedFlag, implementedFlag } from '../describe-cli-surface.schema.js'
import { describeCliSurface, RenderSchemaDocumentCommand } from '../describe-cli-surface.workflow.js'
import { analyzeFlags } from '../run-attw.command.js'

const wiredKeys = (value: MachineEnvelope): readonly string[] => Object.keys(value)

const envelopeContract: Readonly<Record<MachineEnvelope['status'], readonly string[]>> = {
  ok: [
    'status',
    'packageName',
    'packageVersion',
    'types',
    'problems',
    'problemCounts',
    'entrypoints',
    'buildTools',
    'programInfo',
  ],
  untyped: ['status', 'packageName', 'packageVersion', 'types'],
}

it.prop('∀flag_ImplementedFlag_∈SchemaDocument', [implementedFlag], ([flag]) => documentedFlags.includes(flag))

it.prop(
  '∀flag_SchemaDocumentFlag_∈Implemented',
  [documentedFlag],
  ([flag]) => Object.keys(analyzeFlags).includes(flag),
)

it.prop(
  '∀key_SchemaDocumentEnvelopeKey_∈EnvelopeContract',
  [documentedEnvelopeKey],
  ([key]) => envelopeContract.ok.includes(key) || envelopeContract.untyped.includes(key),
)

it.prop(
  '∀envelope_EnvelopeWireKeys_∈SchemaDocument',
  [MachineEnvelopeSchema],
  ([value]) =>
    envelopeContract[value.status].every((key) => documentedEnvelopeKeys.includes(key)) &&
    wiredKeys(value).every((key) => documentedEnvelopeKeys.includes(key)),
)

it.prop(
  '∀envelope_DecodeEnvelope_=Accepted',
  [MachineEnvelopeSchema],
  ([value]) => Result.isSuccess(decodeEnvelopeDocument(new EnvelopeDocumentCommand({ value }))),
)

it.prop('∀version_SchemaDocument_=version', [Schema.String], ([version]) => {
  const document = buildSchemaDocument(version)
  return document.version === version
})

it.prop('∀version_SchemaSurface_=rendered∨unusable', [Schema.String], ([version]) =>
  Result.match(
    describeCliSurface(new RenderSchemaDocumentCommand({ version, target: Option.none() })),
    {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('SchemaRendered', ({ version: rendered }) => version.trim().length > 0 && rendered === version),
          Match.tag('SchemaUsageRefused', () => false),
          Match.exhaustive,
        ),
      onFailure: (refusal) => version.trim().length === 0 && refusal.version === version,
    },
  ))

it.prop('∀target_SchemaSurface_=UsageRefused', [Schema.String], ([target]) =>
  Result.match(
    describeCliSurface(new RenderSchemaDocumentCommand({ version: cliVersion, target: Option.some(target) })),
    {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('SchemaUsageRefused', ({ recovery }) => recovery.includes('--help') && recovery.includes('schema')),
          Match.tag('SchemaRendered', () => false),
          Match.exhaustive,
        ),
      onFailure: () => false,
    },
  ))
