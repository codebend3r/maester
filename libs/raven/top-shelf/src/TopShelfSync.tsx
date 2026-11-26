import type { ComponentType, ReactNode } from 'react'
import { Platform } from 'react-native'

import type { TopShelfInvitation } from '@/contract'
import { useTopShelf } from '@/useTopShelf'

/** The system whose TVs have a Top Shelf: tvOS reports itself as iOS. */
const TOP_SHELF_OS = { ios: 'ios' } as const

/** Only the Apple TV has a Top Shelf; an iPhone, an iPad and Android TV's home screen show none of an app's own. */
const HAS_TOP_SHELF = Platform.OS === TOP_SHELF_OS.ios && Platform.isTV

const ACCOUNT_STATES = { signedIn: 'signedIn', signedOut: 'signedOut' } as const

type AccountState = (typeof ACCOUNT_STATES)[keyof typeof ACCOUNT_STATES]

/** What the app's own signed-in shelf is handed: the session it reads its titles through. */
export type SignedInShelfProps<Session> = { session: Session }

type TopShelfSyncProps<Session> = {
  /** The session while the app is open to the viewer; null shows the invitation. */
  session: Session | null
  /** The invitation to sign in, shown while nobody is. */
  signedOut: TopShelfInvitation
  /** The app's own shelf while an account is signed in, which writes it through `useTopShelf`. */
  SignedIn: ComponentType<SignedInShelfProps<Session>>
}

/** One account state's shelf, for any app's session. */
type AccountShelf = <Session>(props: TopShelfSyncProps<Session>) => ReactNode

const SignedInShelf: AccountShelf = ({ session, SignedIn }) =>
  session !== null && <SignedIn session={session} />

const SignedOutShelf: AccountShelf = ({ signedOut }) => {
  useTopShelf(signedOut)
  return null
}

const SHELVES = {
  [ACCOUNT_STATES.signedIn]: SignedInShelf,
  [ACCOUNT_STATES.signedOut]: SignedOutShelf,
} as const satisfies Record<AccountState, AccountShelf>

/**
 * What the Apple TV's home screen shows above the app's tile: the app's own shelf while an
 * account is signed in, the invitation to sign in while none is. It draws nothing; it writes the
 * shelf the Top Shelf extension reads, and does nothing on any other device.
 */
export const TopShelfSync = <Session,>(props: TopShelfSyncProps<Session>) => {
  const Shelf = SHELVES[props.session === null ? ACCOUNT_STATES.signedOut : ACCOUNT_STATES.signedIn]
  return HAS_TOP_SHELF && <Shelf {...props} />
}
