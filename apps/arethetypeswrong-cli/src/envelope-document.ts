import type { MachineEnvelope } from './decode-envelope-document.workflow.js'
import { renderJson } from './RenderJson.js'

export const renderEnvelopeDocument = (document: MachineEnvelope): string =>
  renderJson(document, { pretty: false }) + '\n'
