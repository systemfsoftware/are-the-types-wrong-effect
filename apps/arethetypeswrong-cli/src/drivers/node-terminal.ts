import { Effect, Layer } from 'effect'

import { Terminal } from '../terminal.service.js'
import { TerminalObservations, TerminalWriteRefused } from '../TerminalError.schema.js'

const FALLBACK_TERMINAL_WIDTH = 120

const fallbackOrDefault = (fallbackWidth: number | undefined): number =>
  fallbackWidth === undefined ? FALLBACK_TERMINAL_WIDTH : fallbackWidth

const writeStdout = (text: string) =>
  Effect.try({
    try: () => {
      process.stdout.write(text)
    },
    catch: (cause) => new TerminalWriteRefused({ stream: 'stdout', cause }),
  })

const writeStderr = (text: string) =>
  Effect.try({
    try: () => {
      process.stderr.write(text)
    },
    catch: (cause) => new TerminalWriteRefused({ stream: 'stderr', cause }),
  })

const ttyColumns = (): number | undefined => {
  if (process.stdout.isTTY !== true) return undefined
  return process.stdout.columns
}

const observedWidth = (fallbackWidth: number): number => {
  const columns = ttyColumns()
  if (typeof columns === 'number') return columns
  return fallbackWidth
}

const serviceOf = (fallbackWidth: number): Terminal['Service'] =>
  Terminal.of({
    write: writeStdout,
    writeError: writeStderr,
    observations: Effect.succeed(
      new TerminalObservations({
        isTty: process.stdout.isTTY === true,
        width: observedWidth(fallbackWidth),
      }),
    ),
    environment: Effect.succeed(process.env),
    exit: (code) => Effect.sync(() => process.exit(code)),
  })

export interface NodeTerminalOptions {
  readonly fallbackWidth?: number | undefined
}

const fallbackOf = (options: NodeTerminalOptions | undefined): number => fallbackOrDefault(options?.fallbackWidth)

export const layer = (options?: NodeTerminalOptions): Layer.Layer<Terminal> =>
  Layer.succeed(Terminal, serviceOf(fallbackOf(options)))
