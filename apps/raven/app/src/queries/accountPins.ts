import { type LibraryPin, pinnedIdsOn } from '@raven/core'
import { activePinServerIdOf } from '@raven/native/headless'
import {
  type PinToggle,
  libraryPinsQuery,
  usePinToggle as usePinToggleOn,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useAccountSession } from '@/account/session'
import { accountServers, useActiveServer } from '@/stores/activeServer'

// One empty list while there are no pins, so what is built from them is not built again.
const NO_PINS: readonly LibraryPin[] = []

/** The account's pins on every server, as its database holds them. */
export const usePins = (): readonly LibraryPin[] => {
  const userId = useAccountSession((state) => state.session?.userId ?? null)
  return useQuery(libraryPinsQuery({ client: accountServers, userId })).data ?? NO_PINS
}

/** The ids of the libraries the account pinned on the server in use. */
export const usePinnedHere = (): readonly number[] => {
  const pins = usePins()
  const serverId = useActiveServer(activePinServerIdOf)
  return useMemo(() => pinnedIdsOn({ pins, serverId }), [pins, serverId])
}

/**
 * Pin as a toggle for a library on the server in use, kept in the account's database for that
 * server and library, so it shows in the menus of every device the account signs in on. Null
 * while no one is signed in, or on a home too old to say its id.
 */
export const usePinToggle = (libraryId: number): PinToggle | null =>
  usePinToggleOn({
    userId: useAccountSession((state) => state.session?.userId ?? null),
    serverId: useActiveServer(activePinServerIdOf),
    libraryId,
    pins: usePins(),
    setPin: accountServers.setPin,
  })
