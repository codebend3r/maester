import { useQuery } from '@tanstack/react-query'
import { type ComponentType, useEffect } from 'react'
import { CaseTurns } from '@/components/CaseTurns/CaseTurns'
import { Composer } from '@/components/Composer/Composer'
import { SandboxBar } from '@/components/SandboxBar/SandboxBar'
import { Transcript } from '@/components/Transcript/Transcript'
import { type Me, SIGN_IN_STATES, TIERS, fetchMe, fetchSandbox } from '@/lib/api'
import { browser } from '@/lib/browser'
import { QUERY_KEYS } from '@/lib/queryKeys'
import styles from '@/pages/ChatPage/ChatPage.module.scss'
import { CHAT_PAGE_COPY } from '@/pages/ChatPage/copy'
import { useChat } from '@/stores/chat'

const RETURN_TO = 'return_to'

type NoticeProps = { children: string }

const Notice = ({ children }: NoticeProps) => (
  <main className={styles.notice}>
    <p>{children}</p>
  </main>
)

type SignedIn = Extract<Me, { state: typeof SIGN_IN_STATES.signedIn }>

type World = Awaited<ReturnType<typeof fetchSandbox>> | undefined

const CHAT_VIEWS = {
  unreachable: 'unreachable',
  waking: 'waking',
  signingIn: 'signingIn',
  unlinked: 'unlinked',
  ready: 'ready',
} as const

type ChatView = (typeof CHAT_VIEWS)[keyof typeof CHAT_VIEWS]

type ChatViewOfProps = { isError: boolean; me: Me | undefined; isAdopted: boolean }

const chatViewOf = ({ isError, me, isAdopted }: ChatViewOfProps): ChatView => {
  if (isError) return CHAT_VIEWS.unreachable
  if (!me) return CHAT_VIEWS.waking
  if (me.state === SIGN_IN_STATES.signedOut) return CHAT_VIEWS.signingIn
  if (me.tier === TIERS.unlinked) return CHAT_VIEWS.unlinked
  if (!isAdopted) return CHAT_VIEWS.waking
  return CHAT_VIEWS.ready
}

type ChatViewProps = { signedIn: SignedIn | null; world: World }

const Unreachable = () => <Notice>{CHAT_PAGE_COPY.unreachable}</Notice>

const Waking = () => <Notice>{CHAT_PAGE_COPY.waking}</Notice>

const SigningIn = () => <Notice>{CHAT_PAGE_COPY.signingIn}</Notice>

const Unlinked = () => <Notice>{CHAT_PAGE_COPY.unlinked}</Notice>

type ChatRoomProps = { signedIn: SignedIn; world: World }

const ChatRoom = ({ signedIn, world }: ChatRoomProps) => {
  const turns = world?.case.turns ?? []
  return (
    <div className={turns.length > 0 ? styles.withTurns : styles.page}>
      <header className={styles.header}>
        <h1 className={styles.wordmark}>{CHAT_PAGE_COPY.wordmark}</h1>
        {world && <SandboxBar state={world} tier={signedIn.tier} />}
      </header>
      {world && turns.length > 0 && (
        <aside className={styles.turns}>
          <CaseTurns name={world.case.name} turns={turns} />
        </aside>
      )}
      <main className={styles.chat}>
        <section className={styles.conversation} aria-label={CHAT_PAGE_COPY.transcript}>
          <Transcript />
        </section>
        <Composer />
      </main>
    </div>
  )
}

type ReadyProps = ChatViewProps

const Ready = ({ signedIn, world }: ReadyProps) =>
  !!signedIn && <ChatRoom signedIn={signedIn} world={world} />

const CHAT_VIEW_COMPONENTS = {
  [CHAT_VIEWS.unreachable]: Unreachable,
  [CHAT_VIEWS.waking]: Waking,
  [CHAT_VIEWS.signingIn]: SigningIn,
  [CHAT_VIEWS.unlinked]: Unlinked,
  [CHAT_VIEWS.ready]: Ready,
} as const satisfies Record<ChatView, ComponentType<ChatViewProps>>

/** luwin's one page: the conversation, and in the sandbox, its controls and the case's messages. */
export const ChatPage = () => {
  const me = useQuery({ queryKey: QUERY_KEYS.me, queryFn: fetchMe })
  const sandbox = useQuery({ queryKey: QUERY_KEYS.sandbox, queryFn: fetchSandbox })
  // The conversation the server holds: the sandbox world's, else the signed-in user's.
  const signedIn = me.data?.state === SIGN_IN_STATES.signedIn ? me.data : null
  const owner = signedIn && !sandbox.isPending ? (sandbox.data?.world ?? signedIn.id) : null
  const adopt = useChat((state) => state.adopt)
  const isAdopted = useChat((state) => owner != null && state.owner === owner)

  useEffect(() => {
    if (owner != null) adopt(owner)
  }, [owner, adopt])

  useEffect(() => {
    if (me.data?.state !== SIGN_IN_STATES.signedOut) return
    const signIn = new URL(me.data.signIn)
    signIn.searchParams.set(RETURN_TO, window.location.href)
    browser.goTo(signIn.toString())
  }, [me.data])

  const View = CHAT_VIEW_COMPONENTS[chatViewOf({ isError: me.isError, me: me.data, isAdopted })]
  return <View signedIn={signedIn} world={sandbox.data} />
}
