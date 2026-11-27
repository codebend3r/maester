/**
 * What the suite's Electron apps share in their main process: the loopback web host that serves
 * a web app's build and passes `/api` on to its server, and the errors and timers it is built
 * on. The dmg maker their Forge configs read is `@shared/desktop/build`, kept apart so a main
 * bundle never takes in Forge.
 */
export { ERROR_CODES, errorCodeOf, errorText, isPortTaken } from '@/errors'
export { type Timers, createNodeTimers } from '@/timers'
export {
  ALLOWED_METHODS,
  type Handler,
  type InlineHashes,
  LOOPBACK_ADDRESSES,
  type PolicySources,
  type ReachNotes,
  contentSecurityPolicy,
  createWebHostHandler,
  inlineHashesOf,
  listenWebHost,
  webRootFor,
} from '@/webHost'
