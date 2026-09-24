import { Effect, Layer } from 'effect'
import type * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'
import * as Headers from 'effect/unstable/http/Headers'
import * as Client from 'effect/unstable/http/HttpClient'
import type { HttpClientError } from 'effect/unstable/http/HttpClientError'
import * as Request from 'effect/unstable/http/HttpClientRequest'
import * as Response from 'effect/unstable/http/HttpClientResponse'

import { Registry } from '../registry.service.js'
import { RegistryPayloadOverBudget, RegistryUnreachable } from '../RegistryError.schema.js'
import { RegistryDocumentRead, RegistryStatusRead } from '../RegistryObservation.schema.js'

const DEFAULT_TIMEOUT: Duration.Input = '30 seconds'
const DEFAULT_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024

export interface HttpRegistryOptions {
  readonly timeout?: Duration.Input | undefined
  readonly maxPayloadBytes?: number | undefined
}

interface CollectedPayload {
  readonly chunks: Array<Uint8Array>
  readonly size: number
}

const emptyPayload = (): CollectedPayload => ({ chunks: [], size: 0 })

const concatPayload = (payload: CollectedPayload): Uint8Array => {
  const merged = new Uint8Array(payload.size)
  payload.chunks.reduce((offset, chunk) => {
    merged.set(chunk, offset)
    return offset + chunk.byteLength
  }, 0)
  return merged
}

const chargedFor = (
  collected: CollectedPayload,
  chunk: Uint8Array,
  url: string,
  budgetBytes: number,
): Effect.Effect<CollectedPayload, RegistryPayloadOverBudget, never> => {
  collected.chunks.push(chunk)
  const size = collected.size + chunk.byteLength
  if (size > budgetBytes) {
    return Effect.fail(new RegistryPayloadOverBudget({ url, byteLength: size, budgetBytes }))
  }
  return Effect.succeed({ chunks: collected.chunks, size })
}

const boundedSink = (
  url: string,
  budgetBytes: number,
): Sink.Sink<CollectedPayload, Uint8Array, Uint8Array, RegistryPayloadOverBudget> =>
  Sink.fold<CollectedPayload, Uint8Array, RegistryPayloadOverBudget>(
    emptyPayload,
    (collected) => collected.size <= budgetBytes,
    (collected, chunk) => chargedFor(collected, chunk, url, budgetBytes),
  )

const collectBounded = (
  stream: Stream.Stream<Uint8Array, HttpClientError>,
  url: string,
  budgetBytes: number,
): Effect.Effect<CollectedPayload, RegistryPayloadOverBudget | HttpClientError, Scope.Scope> =>
  Effect.scoped(Stream.run(stream, boundedSink(url, budgetBytes)))

const readBoundedStream = (
  incoming: Response.HttpClientResponse,
  url: string,
  budgetBytes: number,
): Effect.Effect<Uint8Array, RegistryPayloadOverBudget | HttpClientError, Scope.Scope> =>
  Effect.map(
    collectBounded(incoming.stream, url, budgetBytes),
    concatPayload,
  )

const declaredLength = (incoming: Response.HttpClientResponse): number =>
  Option.match(Headers.get(incoming.headers, 'content-length'), {
    onNone: () => Number.NaN,
    onSome: (text) => Number(text),
  })

const overDeclared = (
  incoming: Response.HttpClientResponse,
  url: string,
  budgetBytes: number,
  declared: number,
): Effect.Effect<Uint8Array, RegistryPayloadOverBudget | HttpClientError, Scope.Scope> =>
  Match.value(declared > budgetBytes).pipe(
    Match.when(true, () => Effect.fail(new RegistryPayloadOverBudget({ url, byteLength: declared, budgetBytes }))),
    Match.orElse(() => readBoundedStream(incoming, url, budgetBytes)),
  )

const nonDocumentStatus = (
  status: number,
): Effect.Effect<RegistryStatusRead, RegistryPayloadOverBudget | HttpClientError, Scope.Scope> =>
  Effect.succeed(new RegistryStatusRead({ status }))

const readNonDocument = (
  response: Response.HttpClientResponse,
): Effect.Effect<RegistryStatusRead, RegistryPayloadOverBudget | HttpClientError, Scope.Scope> =>
  nonDocumentStatus(response.status)

const responseDocument = (
  response: Response.HttpClientResponse,
  url: string,
  budgetBytes: number,
): Effect.Effect<RegistryDocumentRead, RegistryPayloadOverBudget | HttpClientError, Scope.Scope> =>
  Match.value({ declared: declaredLength(response), status: response.status }).pipe(
    Match.when(
      ({ declared }) => Number.isFinite(declared),
      (both) =>
        Effect.map(
          overDeclared(response, url, budgetBytes, both.declared),
          (bytes) => new RegistryDocumentRead({ status: both.status, bytes }),
        ),
    ),
    Match.orElse((both) =>
      Effect.map(
        readBoundedStream(response, url, budgetBytes),
        (bytes) => new RegistryDocumentRead({ status: both.status, bytes }),
      )
    ),
  )
const answeredStatus = (
  response: Response.HttpClientResponse,
  url: string,
  budgetBytes: number,
): Effect.Effect<RegistryDocumentRead | RegistryStatusRead, RegistryPayloadOverBudget | HttpClientError, Scope.Scope> =>
  Match.value(response.status).pipe(
    Match.when(
      (status) => status < 200 || status >= 300,
      (status) => readNonDocument({ ...response, status }),
    ),
    Match.orElse(() => responseDocument(response, url, budgetBytes)),
  )

const queryObservation = (
  url: string,
  budgetBytes: number,
): Effect.Effect<
  RegistryDocumentRead | RegistryStatusRead,
  RegistryPayloadOverBudget | HttpClientError | Cause.TimeoutError,
  Client.HttpClient | Scope.Scope
> =>
  Effect.flatMap(
    Client.execute(Request.get(url)),
    (response) => answeredStatus(response, url, budgetBytes),
  )

const timedQuery = (
  url: string,
  budgetBytes: number,
  timeout: Duration.Input,
): Effect.Effect<
  RegistryDocumentRead | RegistryStatusRead,
  RegistryPayloadOverBudget | HttpClientError | Cause.TimeoutError,
  Client.HttpClient | Scope.Scope
> => Effect.timeout(Effect.scoped(queryObservation(url, budgetBytes)), timeout)
const failedFetch = (
  failure: RegistryPayloadOverBudget | HttpClientError | Cause.TimeoutError,
  url: string,
): RegistryUnreachable | RegistryPayloadOverBudget =>
  Schema.is(RegistryPayloadOverBudget)(failure)
    ? failure
    : new RegistryUnreachable({ url, cause: failure })

const fetchFor = (
  url: string,
  timeout: Duration.Input,
  budgetBytes: number,
): Effect.Effect<
  RegistryDocumentRead | RegistryStatusRead,
  RegistryUnreachable | RegistryPayloadOverBudget,
  Client.HttpClient | Scope.Scope
> =>
  Effect.mapError(
    timedQuery(url, budgetBytes, timeout),
    (failure) => failedFetch(failure, url),
  )

const documentFor = (
  client: Client.HttpClient,
  url: string,
  timeout: Duration.Input,
  budgetBytes: number,
): Effect.Effect<RegistryDocumentRead | RegistryStatusRead, RegistryUnreachable | RegistryPayloadOverBudget> =>
  Effect.scoped(Effect.provideService(fetchFor(url, timeout, budgetBytes), Client.HttpClient, client))

const serviceWith = (
  client: Client.HttpClient,
  timeout: Duration.Input,
  budgetBytes: number,
): Registry['Service'] =>
  Registry.of({
    fetchDocument: (url) => documentFor(client, url, timeout, budgetBytes),
  })

const resolvedTimeout = (timeout: Duration.Input | undefined): Duration.Input => timeout ?? DEFAULT_TIMEOUT

const resolvedBudget = (budgetBytes: number | undefined): number => budgetBytes ?? DEFAULT_MAX_PAYLOAD_BYTES

const timeoutOf = (options: HttpRegistryOptions | undefined): Duration.Input => resolvedTimeout(options?.timeout)

const budgetOf = (options: HttpRegistryOptions | undefined): number => resolvedBudget(options?.maxPayloadBytes)

export const layer = (options?: HttpRegistryOptions): Layer.Layer<Registry, never, Client.HttpClient> =>
  Layer.effect(
    Registry,
    Effect.map(
      Client.HttpClient,
      (client) => serviceWith(client, timeoutOf(options), budgetOf(options)),
    ),
  )
