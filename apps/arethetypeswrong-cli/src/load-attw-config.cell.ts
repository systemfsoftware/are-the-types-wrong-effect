import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Match } from 'effect'

import { AcquisitionCommandRejected } from './Acquisition.schema.js'
import { Filesystem } from './filesystem.service.js'
import {
  AttwConfigAbsent,
  AttwConfigLoaded,
  ConfigInvalid,
  loadAttwConfig,
  LoadAttwConfigCommand,
} from './load-attw-config.workflow.js'

export interface AttwConfigRequest {
  readonly configPath: string
}

export type LoadAttwConfigAnswer = AttwConfigLoaded | AttwConfigAbsent | ConfigInvalid

type LoadConfigCommand = (typeof LoadAttwConfigCommand)['Encoded']

const absentRaw = (configPath: string): LoadConfigCommand => ({
  _tag: 'LoadAttwConfigCommand',
  request: { _tag: 'AttwConfigFileAbsentCommand', filePath: configPath },
})

const textRaw = (configPath: string, text: string): LoadConfigCommand => ({
  _tag: 'LoadAttwConfigCommand',
  request: { _tag: 'AttwConfigTextCommand', filePath: configPath, text },
})

export const loadAttwConfigFile = Sandwich.named('config.load_attw_config')(
  (request: AttwConfigRequest) =>
    Effect.flatMap(
      Filesystem,
      (fs) =>
        Effect.flatMap(fs.fileExists(request.configPath), (exists) =>
          Match.value(exists).pipe(
            Match.when(false, () => Effect.succeed(absentRaw(request.configPath))),
            Match.orElse(() =>
              Effect.map(fs.readUtf8(request.configPath), (text) => textRaw(request.configPath, text))
            ),
          )),
    ),
)
  .decide(loadAttwConfig)
  .write({
    AttwConfigLoaded: (loaded) => Effect.succeed(new AttwConfigLoaded(loaded)),
    AttwConfigAbsent: (absent) => Effect.succeed(new AttwConfigAbsent(absent)),
    ConfigInvalid: (refused) => Effect.succeed(new ConfigInvalid(refused)),
    CommandRejected: (rejected) => Effect.fail(new AcquisitionCommandRejected({ issue: rejected.issue })),
  })
