import type { ActiveServerStore } from '@/servers/activeServerStore'
import { RAVEN_SERVER } from '@/servers/ravenServer'

type PinRavenServerProps = { servers: Pick<ActiveServerStore, 'getState'> }

/**
 * Leaves raven on Vhagar the one server and the active one, since an installed app talks to it
 * and never asks for another. An end to end build's fixture takes its place, as its origin.
 */
export const pinRavenServer = ({ servers }: PinRavenServerProps): void => {
  const { servers: known, add, remove, activate } = servers.getState()
  known
    .filter(({ id }) => id !== RAVEN_SERVER.id)
    .forEach(({ id }) => {
      remove(id).catch(() => undefined)
    })
  if (!known.some(({ id }) => id === RAVEN_SERVER.id)) add(RAVEN_SERVER)
  activate(RAVEN_SERVER.id)
}
