import type { PosterEntry } from '@raven/core'
import { useTopShelf } from '@raven/top-shelf'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, useMemo } from 'react'

import { DEVICE_PLATFORM } from '@/platform/devicePlatform'
import { APP_PLATFORMS } from '@/platform/platform'
import { showArtIdsOf } from '@/queries/showArt'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { useShowArts } from '@/queries/useShowArts'
import { SIGNED_OUT_SHELF, continueShelfOf } from '@/topShelf/topShelf'

/** Only the Apple TV has a Top Shelf. */
const HAS_TOP_SHELF = DEVICE_PLATFORM === APP_PLATFORMS.tvos

const ACCOUNT_STATES = { signedIn: 'signedIn', signedOut: 'signedOut' } as const

type AccountState = (typeof ACCOUNT_STATES)[keyof typeof ACCOUNT_STATES]

// One empty list while Home is read, so the art's ids are not worked out again for a new one.
const NO_ENTRIES: readonly PosterEntry[] = []

type ContinueShelfProps = { session: AppQueries }

/** Keeps the shelf on Continue watching, read through the cache Home reads it from. */
const ContinueShelf = ({ session }: ContinueShelfProps) => {
  const home = useQuery(session.queries.homeQuery)
  const pictures = usePictures(session)
  const entries = home.data?.inProgress ?? NO_ENTRIES
  const arts = useShowArts({ queries: session.queries, ids: showArtIdsOf(entries), pictures })
  const shelf = useMemo(
    () =>
      home.data === undefined || pictures === null
        ? null
        : continueShelfOf({ entries: home.data.inProgress, arts, ...pictures }),
    [home.data, arts, pictures],
  )
  useTopShelf(shelf)
  return null
}

type ShelfProps = { session: AppQueries | null }

const SignedInShelf = ({ session }: ShelfProps) =>
  session !== null && <ContinueShelf session={session} />

const SignedOutShelf = () => {
  useTopShelf(SIGNED_OUT_SHELF)
  return null
}

const SHELVES = {
  [ACCOUNT_STATES.signedIn]: SignedInShelf,
  [ACCOUNT_STATES.signedOut]: SignedOutShelf,
} as const satisfies Record<AccountState, ComponentType<ShelfProps>>

type TopShelfSyncProps = {
  /** The active server's client while the routes are open to the viewer; null shows the invitation. */
  session: AppQueries | null
}

/**
 * What the Apple TV's home screen shows above raven's tile: Continue watching while an account
 * is signed in, the invitation to sign in while none is. It draws nothing; it writes the shelf
 * the Top Shelf extension reads.
 */
export const TopShelfSync = ({ session }: TopShelfSyncProps) => {
  const Shelf = SHELVES[session === null ? ACCOUNT_STATES.signedOut : ACCOUNT_STATES.signedIn]
  return HAS_TOP_SHELF && <Shelf session={session} />
}
