import { RAIL_COPY } from '@/components/Rail/copy'
import styles from '@/components/Rail/Rail.module.scss'
import { SPARROW_SIZES, SparrowMark } from '@/components/SparrowMark/SparrowMark'
import { useChat } from '@/stores/chat'

/** The icon rail: sparrow's mark, and a new chat, which clears the conversation. */
export const Rail = () => {
  const isBusy = useChat((state) => state.isBusy)
  const startOver = useChat((state) => state.startOver)
  return (
    <nav className={styles.rail} aria-label={RAIL_COPY.label}>
      <span className={styles.badge}>
        <SparrowMark size={SPARROW_SIZES.md} />
      </span>
      <button
        type="button"
        className={styles.newChat}
        aria-label={RAIL_COPY.newChat}
        title={RAIL_COPY.newChat}
        disabled={isBusy}
        onClick={() => void startOver()}
      >
        <span aria-hidden="true">{RAIL_COPY.plus}</span>
      </button>
    </nav>
  )
}
