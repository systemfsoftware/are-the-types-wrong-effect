import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect } from 'effect'

import { AcquisitionCommandRejected } from './Acquisition.schema.js'
import { DecideHintsCommand, type Hint, offerRecoveryHints } from './offer-recovery-hints.workflow.js'
import { RenderedRun } from './run-outcome.schema.js'
import { Terminal } from './terminal.service.js'

export const renderHints = (hints: readonly Hint[]): string => hints.map((hint) => `${hint.text}\n`).join('')

const readHints = (rendered: RenderedRun): Effect.Effect<(typeof DecideHintsCommand)['Encoded'], never, Terminal> =>
  Effect.flatMap(
    Terminal,
    (terminal) =>
      Effect.map(
        terminal.observations,
        (observations): (typeof DecideHintsCommand)['Encoded'] => ({
          _tag: 'DecideHintsCommand',
          request: {
            _tag: 'RunHintsRequest',
            document: rendered.document,
            mode: rendered.mode,
            isTty: observations.isTty,
            include: [...rendered.include],
            mask: rendered.mask,
          },
        }),
      ),
  )

export const offerHintsCell = Sandwich.named('render.offer_hints')(readHints)
  .decide(offerRecoveryHints)
  .write({
    HintsOffered: (offered) =>
      Effect.flatMap(Terminal, (terminal) => Effect.as(terminal.writeError(renderHints(offered.hints)), undefined)),
    NoHintsApplicable: () => Effect.void,
    InvalidPackageSpec: (refused) => Effect.fail(new AcquisitionCommandRejected({ issue: refused.message })),
    CommandRejected: (rejected) => Effect.fail(rejected),
  })
