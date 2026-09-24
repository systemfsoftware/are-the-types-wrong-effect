import { Effect, Match, Option, Result } from 'effect'
import * as JsonSchema from 'effect/JsonSchema'
import * as S from 'effect/Schema'
import * as Command from 'effect/unstable/cli/Command'

import { cliVersion } from './cli-version.js'
import { CliInputSchema } from './CliInput.schema.js'
import { MachineEnvelopeSchema } from './decode-envelope-document.workflow.js'
import { describeCliSurface, RenderSchemaDocumentCommand } from './describe-cli-surface.workflow.js'
import { renderJson } from './RenderJson.js'
import { Terminal } from './terminal.service.js'

export interface SchemaDocument {
  readonly version: string
  readonly input: JsonSchema.Document<'draft-2020-12'>
  readonly envelope: JsonSchema.Document<'draft-2020-12'>
}

export const buildSchemaDocument = (version: string): SchemaDocument => ({
  version,
  input: S.toJsonSchemaDocument(CliInputSchema),
  envelope: S.toJsonSchemaDocument(MachineEnvelopeSchema),
})

export const renderSchemaDocument = (document: SchemaDocument): string => {
  const input = Result.getOrThrow(S.decodeUnknownResult(S.Json)(document.input))
  const envelope = Result.getOrThrow(S.decodeUnknownResult(S.Json)(document.envelope))
  return renderJson({ version: document.version, input, envelope }, { pretty: false }) + '\n'
}

const isSchemaNode = (variant: unknown): variant is JsonSchema.JsonSchema => variant instanceof Object

const schemaArray = (document: JsonSchema.Document<'draft-2020-12'>): readonly JsonSchema.JsonSchema[] => {
  const variants = document.schema['anyOf']
  return Array.isArray(variants) ? variants.filter(isSchemaNode) : []
}

const propertyNamesOf = (schema: JsonSchema.JsonSchema): readonly string[] => {
  const properties = schema['properties']
  if (properties instanceof Object) return Object.keys(properties)
  return []
}

const documentedPropertyNames = (document: JsonSchema.Document<'draft-2020-12'>): readonly string[] => {
  const variants = [...schemaArray(document), ...Object.values(document.definitions)]
  const names = [
    ...propertyNamesOf(document.schema),
    ...variants.flatMap((variant) => propertyNamesOf(variant)),
  ]
  return names.filter((name, index) => names.indexOf(name) === index)
}

const publishedSchemaDocument = buildSchemaDocument(cliVersion)

export const documentedFlags: readonly string[] = documentedPropertyNames(publishedSchemaDocument.input)

export const documentedEnvelopeKeys: readonly string[] = documentedPropertyNames(publishedSchemaDocument.envelope)

export const schemaCommand = Command.make('schema', {}, () =>
  Effect.gen(function*() {
    const terminal = yield* Terminal
    const decision = Result.getOrThrow(
      describeCliSurface(new RenderSchemaDocumentCommand({ version: cliVersion, target: Option.none() })),
    )
    yield* Match.value(decision).pipe(
      Match.tag('SchemaRendered', ({ version }) => terminal.write(renderSchemaDocument(buildSchemaDocument(version)))),
      Match.tag('SchemaUsageRefused', ({ recovery }) =>
        terminal.writeError(`${recovery}\n`).pipe(Effect.andThen(Effect.sync(() => {
          process.exitCode = 1
        })))),
      Match.exhaustive,
    )
  }))
