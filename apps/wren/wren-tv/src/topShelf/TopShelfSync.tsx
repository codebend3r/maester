import { useTopShelf } from '@raven/top-shelf'
import { RECENT_SORTS } from '@raven/wren'
import { type WrenSession, useCovers, useRecentAlbums } from '@raven/wren-native'
import type { ComponentType } from 'react'
import { Platform } from 'react-native'

import { SYSTEMS } from '@/music/audioPlatform'
import { SIGNED_OUT_SHELF, TOP_SHELF_ALBUMS, releasesShelfOf } from '@/topShelf/topShelf'

/** Only the Apple TV has a Top Shelf; Android TV's home screen shows none of an app's own. */
const HAS_TOP_SHELF = Platform.OS === SYSTEMS.ios

const ACCOUNT_STATES = { signedIn: 'signedIn', signedOut: 'signedOut' } as const

type AccountState = (typeof ACCOUNT_STATES)[keyof typeof ACCOUNT_STATES]

type ReleasesShelfProps = { session: WrenSession }

/**
 * Keeps the shelf on the latest releases once every music library has answered. It is built
 * afresh each render, as `coverOf` is; `useTopShelf` writes it only when its titles change.
 */
const ReleasesShelf = ({ session }: ReleasesShelfProps) => {
  const { coverOf } = useCovers(session)
  const { albums, listing } = useRecentAlbums({
    session,
    sort: RECENT_SORTS.release,
    limit: TOP_SHELF_ALBUMS,
  })
  useTopShelf(listing.isRead ? releasesShelfOf({ albums, coverOf }) : null)
  return null
}

type ShelfProps = { session: WrenSession | null }

const SignedInShelf = ({ session }: ShelfProps) =>
  session !== null && <ReleasesShelf session={session} />

const SignedOutShelf = () => {
  useTopShelf(SIGNED_OUT_SHELF)
  return null
}

const SHELVES = {
  [ACCOUNT_STATES.signedIn]: SignedInShelf,
  [ACCOUNT_STATES.signedOut]: SignedOutShelf,
} as const satisfies Record<AccountState, ComponentType<ShelfProps>>

type TopShelfSyncProps = {
  /** The active server while the tabs are open to the listener; null shows the invitation. */
  session: WrenSession | null
}

/**
 * What the Apple TV's home screen shows above Wren's tile: the latest releases while an account
 * is signed in, the invitation to sign in while none is. It draws nothing; it writes the shelf
 * the Top Shelf extension reads.
 */
export function TopShelfSync({ session }: TopShelfSyncProps) {
  const Shelf = SHELVES[session === null ? ACCOUNT_STATES.signedOut : ACCOUNT_STATES.signedIn]
  return HAS_TOP_SHELF && <Shelf session={session} />
}
