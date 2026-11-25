import type { AccountServer, Library, LibraryPin } from '@raven/core'
import type { PinnedLibrary } from '@/lib/pins'
import { SERVER_KINDS, type ServerEntry } from '@/lib/servers'
import { HOME_ID } from '@/test/authClient'

/** Another server's id: Meleys, an account's second server. */
export const MELEYS_ID = '0b5f8f0e-6c55-4b8e-9d0a-1f6f3c8e2a11'

export const MELEYS_ORIGIN = 'https://meleys.example:8443'

/** The home server as the list shows it: the page's own origin. */
export const homeEntry = (): ServerEntry => ({
  kind: SERVER_KINDS.home,
  key: HOME_ID,
  serverId: HOME_ID,
  name: window.location.host,
  origin: window.location.origin,
  apiBase: '',
})

/** The account's row for Meleys. */
export const meleysRow = (overrides: Partial<AccountServer> = {}): AccountServer => ({
  id: '5d6e7f80-9a0b-4c1d-8e2f-3a4b5c6d7e8f',
  serverId: MELEYS_ID,
  name: 'Meleys',
  origin: MELEYS_ORIGIN,
  addedAt: '2026-11-20T09:00:00.000Z',
  ...overrides,
})

/** Meleys as the list shows it. */
export const meleysEntry = (): ServerEntry => ({
  kind: SERVER_KINDS.account,
  key: MELEYS_ID,
  serverId: MELEYS_ID,
  rowId: meleysRow().id,
  name: 'Meleys',
  origin: MELEYS_ORIGIN,
  apiBase: MELEYS_ORIGIN,
})

type PinnedOfProps = {
  library: Library
  server?: ServerEntry
  isOnActiveServer?: boolean
  /** Whether it names its server, as it does while the account keeps several. */
  isServerNamed?: boolean
}

/** A library pinned on `server`, home's unless named. */
export const pinnedOf = ({
  library,
  server = homeEntry(),
  isOnActiveServer = true,
  isServerNamed = false,
}: PinnedOfProps): PinnedLibrary => ({
  key: `${server.key}:${library.id}`,
  library,
  server,
  serverNote: isServerNamed ? server.name : undefined,
  isOnActiveServer,
})

type PinProps = { serverId?: string; libraryId: number }

/** The account's pin of a library on a server, home's unless named. */
export const pin = ({ serverId = HOME_ID, libraryId }: PinProps): LibraryPin => ({
  serverId,
  libraryId,
  pinnedAt: '2026-11-21T09:00:00.000Z',
})
