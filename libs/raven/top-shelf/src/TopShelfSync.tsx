import type { ComponentType, ReactNode } from 'react'
import { Platform } from 'react-native'

import type { TopShelf } from '@/contract'
import { useTopShelf } from '@/useTopShelf'

const SYSTEMS = { ios: 'ios' } as const

/** Only the Apple TV has a Top Shelf; Android TV's home screen shows none of an app's own. */
const HAS_TOP_SHELF = Platform.OS === SYSTEMS.ios && Platform.isTV

const ACCOUNT_STATES = { signedIn: 'signedIn', signedOut: 'signedOut' } as const

type AccountState = (typeof ACCOUNT_STATES)[keyof typeof ACCOUNT_STATES]

/** What an app's signed in shelf is handed: the session it reads its titles through. */
export type SignedInShelfProps<Session> = { session: Session }

type TopShelfSyncProps<Session> = {
  /** The active session while the app's screens are open to the viewer; null shows the invitation. */
  session: Session | null
  /** The invitation to sign in. */
  signedOut: TopShelf
  /** Keeps the shelf on the app's titles, through `useTopShelf`, while a session is open. */
  SignedIn: ComponentType<SignedInShelfProps<Session>>
}

type Shelf = <Session>(props: TopShelfSyncProps<Session>) => ReactNode

const SignedInShelf: Shelf = ({ session, SignedIn }) =>
  session !== null && <SignedIn session={session} />

const SignedOutShelf: Shelf = ({ signedOut }) => {
  useTopShelf(signedOut)
  return null
}

const SHELVES = {
  [ACCOUNT_STATES.signedIn]: SignedInShelf,
  [ACCOUNT_STATES.signedOut]: SignedOutShelf,
} as const satisfies Record<AccountState, Shelf>

/**
 * What the Apple TV's home screen shows above the app's tile: the app's own titles while a
 * session is open, the invitation to sign in while none is. It draws nothing; it writes the
 * shelf the Top Shelf extension reads, and on any other device it does nothing at all.
 */
export const TopShelfSync = <Session,>(props: TopShelfSyncProps<Session>) => {
  const Shelf = SHELVES[props.session === null ? ACCOUNT_STATES.signedOut : ACCOUNT_STATES.signedIn]
  return HAS_TOP_SHELF && <Shelf {...props} />
}
