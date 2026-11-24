import { isMediaId, isUuid } from '@/contract/ids'
import { type Infer, isString, object } from '@/schema'
import { isServerOrigin } from '@/serverOrigin'

/**
 * A raven server's own id, a uuid it makes once and keeps: what an account's
 * server list and pins key on, since one server answers at several origins.
 */
export const isServerId = isUuid

export type ServerId = Infer<typeof isServerId>

/** The most libraries an account pins, across every server; the database holds it to this too. */
export const PINS_CAP = 100

/** One extra server on an account's list, as the account's database answers it. */
export const isAccountServer = object({
  /** The row's own id, what a rename or a removal names. */
  id: isUuid,
  serverId: isServerId,
  name: isString,
  origin: isServerOrigin,
  addedAt: isString,
})

export type AccountServer = Infer<typeof isAccountServer>

/** A library an account pinned, on whichever server holds it. */
export const isLibraryPin = object({
  serverId: isServerId,
  libraryId: isMediaId,
  pinnedAt: isString,
})

export type LibraryPin = Infer<typeof isLibraryPin>
