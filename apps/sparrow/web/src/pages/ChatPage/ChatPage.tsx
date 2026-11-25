import { useQuery } from '@tanstack/react-query'
import { type ComponentType, type ReactNode, createElement, useEffect } from 'react'
import { Button } from '@/components/Button/Button'
import { Composer } from '@/components/Composer/Composer'
import { Rail } from '@/components/Rail/Rail'
import { RAIL_COPY } from '@/components/Rail/copy'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { SignIn } from '@/components/SignIn/SignIn'
import { Transcript } from '@/components/Transcript/Transcript'
import {
  AUTH_CONFIG_STATES,
  type AuthConfig,
  type Me,
  SIGN_IN_STATES,
  type SandboxState,
  fetchAuthConfig,
  fetchMe,
  fetchSandbox,
} from '@/lib/api'
import { QUERY_KEYS } from '@/lib/queryKeys'
import { signOut } from '@/lib/signIn'
import styles from '@/pages/ChatPage/ChatPage.module.scss'
import { CHAT_PAGE_COPY } from '@/pages/ChatPage/copy'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { useChat } from '@/stores/chat'

type NoticeProps = { children: ReactNode }

const Notice = ({ children }: NoticeProps) => <main className={styles.notice}>{children}</main>

type SignedIn = Extract<Me, { state: typeof SIGN_IN_STATES.signedIn }>

const CHAT_VIEWS = {
  unreachable: 'unreachable',
  waking: 'waking',
  signIn: 'signIn',
  signInUnavailable: 'signInUnavailable',
  notApproved: 'notApproved',
  ready: 'ready',
} as const

type ChatView = (typeof CHAT_VIEWS)[keyof typeof CHAT_VIEWS]

type ChatRoomProps = { signedIn: SignedIn; world: SandboxState | null }

/** What each view is handed: the ready one the room, the others nothing. */
type ChatViewProps = Record<Exclude<ChatView, typeof CHAT_VIEWS.ready>, Record<string, never>> &
  Record<typeof CHAT_VIEWS.ready, ChatRoomProps>

type ChatViews = { [K in ChatView]: ComponentType<ChatViewProps[K]> }

/** A view, with the props it is handed. */
type Shown<K extends ChatView> = { view: K; props: ChatViewProps[K] }

type ShownView = { [K in ChatView]: Shown<K> }[ChatView]

const NONE: Record<string, never> = {}

const SHOWN = {
  unreachable: { view: CHAT_VIEWS.unreachable, props: NONE },
  waking: { view: CHAT_VIEWS.waking, props: NONE },
  signIn: { view: CHAT_VIEWS.signIn, props: NONE },
  signInUnavailable: { view: CHAT_VIEWS.signInUnavailable, props: NONE },
  notApproved: { view: CHAT_VIEWS.notApproved, props: NONE },
} as const satisfies Record<Exclude<ChatView, typeof CHAT_VIEWS.ready>, ShownView>

/** The views a refusal of `/api/me` shows. */
const REFUSED_VIEWS = {
  [SIGN_IN_STATES.notApproved]: SHOWN.notApproved,
  [SIGN_IN_STATES.unavailable]: SHOWN.signInUnavailable,
} as const

type SignedOutViewProps = {
  config: AuthConfig | undefined
  isSessionRead: boolean
  isAsking: boolean
}

/** Signed out: the form once raven's sign-in is known to be up and the kept session read, else why not. */
const signedOutView = ({ config, isSessionRead, isAsking }: SignedOutViewProps): ShownView => {
  if (config === undefined || isAsking) return SHOWN.waking
  if (config.state !== AUTH_CONFIG_STATES.ready) return SHOWN.signInUnavailable
  return isSessionRead ? SHOWN.signIn : SHOWN.waking
}

type ChatViewOfProps = {
  isError: boolean
  me: Me | undefined
  world: SandboxState | null
  isAdopted: boolean
  signedOut: SignedOutViewProps
}

const chatViewOf = ({ isError, me, world, isAdopted, signedOut }: ChatViewOfProps): ShownView => {
  if (isError) return SHOWN.unreachable
  if (!me) return SHOWN.waking
  if (me.state === SIGN_IN_STATES.signedOut) return signedOutView(signedOut)
  if (me.state !== SIGN_IN_STATES.signedIn) return REFUSED_VIEWS[me.state]
  if (!isAdopted) return SHOWN.waking
  return { view: CHAT_VIEWS.ready, props: { signedIn: me, world } }
}

const Unreachable = () => (
  <Notice>
    <p>{CHAT_PAGE_COPY.unreachable}</p>
  </Notice>
)

const Waking = () => (
  <Notice>
    <p>{CHAT_PAGE_COPY.waking}</p>
  </Notice>
)

const SignInUnavailable = () => (
  <Notice>
    <p>{CHAT_PAGE_COPY.signInUnavailable}</p>
  </Notice>
)

/** Signed in to raven, but not approved there yet: whom to ask, and a way out to another account. */
const NotApproved = () => (
  <Notice>
    <p>{CHAT_PAGE_COPY.notApproved}</p>
    <Button onClick={() => signOut().catch(() => undefined)}>{RAIL_COPY.signOut}</Button>
  </Notice>
)

/** The app: the icon rail, the sidebar, and the conversation with the composer under it. */
const ChatRoom = ({ signedIn, world }: ChatRoomProps) => (
  <div className={styles.page}>
    <div className={styles.rail}>
      <Rail />
    </div>
    <div className={styles.sidebar}>
      <Sidebar world={world} tier={signedIn.tier} />
    </div>
    <main className={styles.chat}>
      <section className={styles.conversation} aria-label={CHAT_PAGE_COPY.transcript}>
        <Transcript tier={signedIn.tier} />
      </section>
      <div className={styles.composer}>
        <Composer />
      </div>
    </main>
  </div>
)

const CHAT_VIEW_COMPONENTS = {
  [CHAT_VIEWS.unreachable]: Unreachable,
  [CHAT_VIEWS.waking]: Waking,
  [CHAT_VIEWS.signIn]: SignIn,
  [CHAT_VIEWS.signInUnavailable]: SignInUnavailable,
  [CHAT_VIEWS.notApproved]: NotApproved,
  [CHAT_VIEWS.ready]: ChatRoom,
} as const satisfies ChatViews

// Read through the mapped type, so a view is looked up with its own props.
const chatViews: ChatViews = CHAT_VIEW_COMPONENTS

/** A view, rendered with its props; `createElement`, since JSX can't check a generic view's props. */
const ShownChatView = <K extends ChatView>({ view, props }: Shown<K>) =>
  createElement(chatViews[view], props)

const signedInOf = (me: Me | undefined): SignedIn | null => {
  if (!me || me.state !== SIGN_IN_STATES.signedIn) return null
  return me
}

type OwnerOfProps = {
  signedIn: SignedIn | null
  world: SandboxState | null
  isSandboxPending: boolean
}

/** Whose conversation the server holds: the sandbox world's, else the signed-in user's. */
const ownerOf = ({ signedIn, world, isSandboxPending }: OwnerOfProps): string | null => {
  if (!signedIn || isSandboxPending) return null
  return world === null ? signedIn.id : world.world
}

/** sparrow's one page: the conversation, and in the sandbox, its controls and the case's messages. */
export const ChatPage = () => {
  const accountId = useAuthSession((state) => state.session?.userId ?? null)
  const isSessionRead = useAuthSession((state) => state.status === AUTH_SESSION_STATUSES.ready)
  const startSession = useAuthSession((state) => state.start)
  // Keyed by the account, so signing in, out or as someone else asks sparrow again.
  const me = useQuery({ queryKey: [...QUERY_KEYS.me, accountId], queryFn: fetchMe })
  const sandbox = useQuery({ queryKey: QUERY_KEYS.sandbox, queryFn: fetchSandbox })
  const isSignedOut = me.data?.state === SIGN_IN_STATES.signedOut
  const config = useQuery({
    queryKey: QUERY_KEYS.authConfig,
    queryFn: fetchAuthConfig,
    enabled: isSignedOut,
  }).data
  const signedIn = signedInOf(me.data)
  const world = sandbox.data ?? null
  const owner = ownerOf({ signedIn, world, isSandboxPending: sandbox.isPending })
  const adopt = useChat((state) => state.adopt)
  const isAdopted = useChat((state) => owner != null && state.owner === owner)

  useEffect(() => {
    if (owner != null) adopt(owner)
  }, [owner, adopt])

  // Only once sparrow asks for a sign-in: the sandbox never does, and never builds a client.
  useEffect(() => {
    if (config === undefined || config.state !== AUTH_CONFIG_STATES.ready) return
    // The client's load answers null rather than rejecting; the catch only keeps the promise from floating.
    startSession({ config }).catch(() => undefined)
  }, [config, startSession])

  const shown = chatViewOf({
    isError: me.isError,
    me: me.data,
    world,
    isAdopted,
    signedOut: { config, isSessionRead, isAsking: me.isFetching },
  })
  return <ShownChatView {...shown} />
}
