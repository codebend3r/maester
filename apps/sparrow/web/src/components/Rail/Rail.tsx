import { RAIL_COPY } from '@/components/Rail/copy'
import styles from '@/components/Rail/Rail.module.scss'
import { SPARROW_SIZES, SparrowMark } from '@/components/SparrowMark/SparrowMark'
import { signOut } from '@/lib/signIn'
import { useAuthSession } from '@/stores/authSession'
import { useChat } from '@/stores/chat'

/** The icon rail: sparrow's mark, a new chat, which clears the conversation, and signing out. */
export const Rail = () => {
  const isBusy = useChat((state) => state.isBusy)
  const startOver = useChat((state) => state.startOver)
  const isSignedIn = useAuthSession((state) => state.session !== null)
  return (
    <nav className={styles.rail} aria-label={RAIL_COPY.label}>
      <span className={styles.badge}>
        <SparrowMark size={SPARROW_SIZES.md} />
      </span>
      <button
        type="button"
        className={styles.railButton}
        aria-label={RAIL_COPY.newChat}
        title={RAIL_COPY.newChat}
        disabled={isBusy}
        onClick={() => void startOver()}
      >
        <span aria-hidden="true">{RAIL_COPY.plus}</span>
      </button>
      {isSignedIn && (
        <button
          type="button"
          className={styles.railButton}
          aria-label={RAIL_COPY.signOut}
          title={RAIL_COPY.signOut}
          disabled={isBusy}
          onClick={() => signOut().catch(() => undefined)}
        >
          <span aria-hidden="true">{RAIL_COPY.door}</span>
        </button>
      )}
    </nav>
  )
}
