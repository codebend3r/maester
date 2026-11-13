import { useQuery } from '@tanstack/react-query'
import { type ComponentType, createElement, useEffect } from 'react'
import { Composer } from '@/components/Composer/Composer'
import { Rail } from '@/components/Rail/Rail'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { Transcript } from '@/components/Transcript/Transcript'
import { type Me, SIGN_IN_STATES, type SandboxState, TIERS, fetchMe, fetchSandbox } from '@/lib/api'
import { browser } from '@/lib/browser'
import { QUERY_KEYS } from '@/lib/queryKeys'
import styles from '@/pages/ChatPage/ChatPage.module.scss'
import { CHAT_PAGE_COPY } from '@/pages/ChatPage/copy'
import { useChat } from '@/stores/chat'

/** The query parameters this page writes into another app's address. */
const QUERY_PARAMS = { returnTo: 'return_to' } as const

type NoticeProps = { children: string }

const Notice = ({ children }: NoticeProps) => (
  <main className={styles.notice}>
    <p>{children}</p>
  </main>
)

type SignedIn = Extract<Me, { state: typeof SIGN_IN_STATES.signedIn }>

const CHAT_VIEWS = {
  unreachable: 'unreachable',
  waking: 'waking',
  signingIn: 'signingIn',
  unlinked: 'unlinked',
  ready: 'ready',
} as const

type ChatView = (typeof CHAT_VIEWS)[keyof typeof CHAT_VIEWS]

type ChatRoomProps = { signedIn: SignedIn; world: SandboxState | null }

/** What each view is handed: the ready one the room, the notices nothing. */
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
  signingIn: { view: CHAT_VIEWS.signingIn, props: NONE },
  unlinked: { view: CHAT_VIEWS.unlinked, props: NONE },
} as const satisfies Record<Exclude<ChatView, typeof CHAT_VIEWS.ready>, ShownView>

type ChatViewOfProps = {
  isError: boolean
  me: Me | undefined
  world: SandboxState | null
  isAdopted: boolean
}

const chatViewOf = ({ isError, me, world, isAdopted }: ChatViewOfProps): ShownView => {
  if (isError) return SHOWN.unreachable
  if (!me) return SHOWN.waking
  if (me.state === SIGN_IN_STATES.signedOut) return SHOWN.signingIn
  if (me.tier === TIERS.unlinked) return SHOWN.unlinked
  if (!isAdopted) return SHOWN.waking
  return { view: CHAT_VIEWS.ready, props: { signedIn: me, world } }
}

const Unreachable = () => <Notice>{CHAT_PAGE_COPY.unreachable}</Notice>

const Waking = () => <Notice>{CHAT_PAGE_COPY.waking}</Notice>

const SigningIn = () => <Notice>{CHAT_PAGE_COPY.signingIn}</Notice>

const Unlinked = () => <Notice>{CHAT_PAGE_COPY.unlinked}</Notice>

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
  [CHAT_VIEWS.signingIn]: SigningIn,
  [CHAT_VIEWS.unlinked]: Unlinked,
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
  const me = useQuery({ queryKey: QUERY_KEYS.me, queryFn: fetchMe })
  const sandbox = useQuery({ queryKey: QUERY_KEYS.sandbox, queryFn: fetchSandbox })
  const signedIn = signedInOf(me.data)
  const world = sandbox.data ?? null
  const owner = ownerOf({ signedIn, world, isSandboxPending: sandbox.isPending })
  const adopt = useChat((state) => state.adopt)
  const isAdopted = useChat((state) => owner != null && state.owner === owner)

  useEffect(() => {
    if (owner != null) adopt(owner)
  }, [owner, adopt])

  useEffect(() => {
    const seen = me.data
    if (!seen || seen.state !== SIGN_IN_STATES.signedOut) return
    const signIn = new URL(seen.signIn)
    signIn.searchParams.set(QUERY_PARAMS.returnTo, window.location.href)
    browser.goTo(signIn.toString())
  }, [me.data])

  const shown = chatViewOf({ isError: me.isError, me: me.data, world, isAdopted })
  return <ShownChatView {...shown} />
}
