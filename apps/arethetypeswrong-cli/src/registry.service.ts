import { Context, Effect } from 'effect'

import type { RegistryUnreachable } from './RegistryError.schema.js'
import type { RegistryPayloadOverBudget } from './RegistryError.schema.js'
import type { RegistryDocumentRead, RegistryStatusRead } from './RegistryObservation.schema.js'

export type RegistryObservation = RegistryDocumentRead | RegistryStatusRead

export type RegistryRefusal = RegistryUnreachable | RegistryPayloadOverBudget

export interface RegistryService {
  readonly fetchDocument: (url: string) => Effect.Effect<RegistryObservation, RegistryRefusal>
}

export class Registry extends Context.Service<Registry, RegistryService>()(
  '@systemfsoftware/arethetypeswrong-cli/registry.service/Registry',
) {}
