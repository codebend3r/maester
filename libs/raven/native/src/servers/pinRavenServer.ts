import type { ActiveServerStore } from '@/servers/activeServerStore'
import { RAVEN_SERVER } from '@/servers/ravenServer'

type PinRavenServerProps = { servers: Pick<ActiveServerStore, 'getState'> }

/**
 * Leaves raven on Vhagar the one server and the active one, since an installed app talks to it
 * and never asks for another. An install that stored it under an older origin moves to the
 * current one. An end to end build's fixture takes its place, as its origin.
 */
export const pinRavenServer = ({ servers }: PinRavenServerProps): void => {
  servers
    .getState()
    .pin(RAVEN_SERVER)
    .catch(() => undefined)
}
