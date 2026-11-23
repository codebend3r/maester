import { useQueryClient } from '@tanstack/react-query'
import { type LibraryPin, PINS_CAP, type ServerId, pinnedIdsOn, pinsToggled } from '@raven/core'
import { libraryPinsQuery } from '@/query/accountQueries'
import { afterPins } from '@/query/invalidate'
import { edit, useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys } from '@/query/queryClient'

/** One press of Pin: the library, the server it is on, and which way it goes. */
export type PinChange = { serverId: ServerId; libraryId: number; shouldPin: boolean }

/** Whether a library is pinned, whether the account's pins are full, and the way to pin or unpin it. */
export type PinToggle = { isPinned: boolean; isFull: boolean; toggle: () => void }

type UsePinToggleProps = {
  /** Who is signed in; null while no one is, who can pin nothing. */
  userId: string | null
  /** The id of the server the library is on; null for one too old to say it, which no pin can name. */
  serverId: ServerId | null
  libraryId: number
  /** The account's pins on every server, as its database holds them. */
  pins: readonly LibraryPin[]
  /** Writes the pin to the account's database, or takes it out. */
  setPin: (change: PinChange) => Promise<unknown>
}

/**
 * Pin as a toggle for one library, kept in the account's database for its server and library. It
 * shows at once and goes back if the database refuses it. Past `PINS_CAP` pins an unpinned
 * library cannot be pinned. Null where the account cannot pin: no one signed in, or a server
 * with no id.
 */
export const usePinToggle = ({
  userId,
  serverId,
  libraryId,
  pins,
  setPin,
}: UsePinToggleProps): PinToggle | null => {
  const queryClient = useQueryClient()
  const { queryKey } = libraryPinsQuery({ client: null, userId })
  const pin = useOptimisticMutation({
    mutationKey: mutationKeys.pin,
    mutationFn: setPin,
    edits: (change: PinChange) => [
      edit({
        queryKey,
        update: (held) =>
          pinsToggled({ pins: held, ...change, pinnedAt: new Date().toISOString() }),
      }),
    ],
    settle: () => afterPins(queryClient),
  })
  if (userId === null || serverId === null) return null
  const isPinned = pinnedIdsOn({ pins, serverId }).includes(libraryId)
  return {
    isPinned,
    isFull: !isPinned && pins.length >= PINS_CAP,
    toggle: () => pin.mutate({ serverId, libraryId, shouldPin: !isPinned }),
  }
}
