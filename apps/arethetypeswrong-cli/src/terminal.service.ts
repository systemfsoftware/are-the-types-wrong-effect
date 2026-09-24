import { Context, Effect } from 'effect'

import { type TerminalObservations, type TerminalWriteRefused } from './TerminalError.schema.js'

export interface TerminalService {
  readonly write: (text: string) => Effect.Effect<void, TerminalWriteRefused>
  readonly writeError: (text: string) => Effect.Effect<void, TerminalWriteRefused>
  readonly observations: Effect.Effect<TerminalObservations>
  readonly environment: Effect.Effect<Readonly<Record<string, string | undefined>>>
  readonly exit: (code: number) => Effect.Effect<never>
}

export class Terminal extends Context.Service<Terminal, TerminalService>()(
  '@systemfsoftware/arethetypeswrong-cli/terminal.service/Terminal',
) {}
