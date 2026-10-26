import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { CaseTurns } from '@/components/CaseTurns/CaseTurns'
import { Composer } from '@/components/Composer/Composer'
import { SandboxBar } from '@/components/SandboxBar/SandboxBar'
import { Transcript } from '@/components/Transcript/Transcript'
import { SIGN_IN_STATES, TIERS, fetchMe, fetchSandbox } from '@/lib/api'
import { browser } from '@/lib/browser'
import { QUERY_KEYS } from '@/lib/queryKeys'
import styles from '@/pages/ChatPage/ChatPage.module.scss'
import { useChat } from '@/stores/chat'

const RETURN_TO = 'return_to'

type NoticeProps = { children: string }

const Notice = ({ children }: NoticeProps) => (
  <main className={styles.notice}>
    <p>{children}</p>
  </main>
)

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

  if (me.isError) return <Notice>Couldn't reach luwin; check that its server is running.</Notice>
  if (!me.data) return <Notice>Waking luwin…</Notice>
  if (me.data.state === SIGN_IN_STATES.signedOut) return <Notice>Sending you to sign in…</Notice>
  if (me.data.tier === TIERS.unlinked) {
    return (
      <Notice>
        Your Plex account doesn't have access to this server yet. Ask the admin or the friend who
        invited you for an invite.
      </Notice>
    )
  }

  if (!isAdopted) return <Notice>Waking luwin…</Notice>

  const world = sandbox.data
  const turns = world?.case.turns ?? []
  return (
    <div className={turns.length > 0 ? styles.withTurns : styles.page}>
      <header className={styles.header}>
        <h1 className={styles.wordmark}>luwin</h1>
        {world && <SandboxBar state={world} tier={me.data.tier} />}
      </header>
      {world && turns.length > 0 && (
        <aside className={styles.turns}>
          <CaseTurns name={world.case.name} turns={turns} />
        </aside>
      )}
      <main className={styles.chat}>
        <Transcript />
        <Composer />
      </main>
    </div>
  )
}
