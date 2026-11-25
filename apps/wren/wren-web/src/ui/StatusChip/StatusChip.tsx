import { classNames } from '@raven/ui/headless'
import { STATUS_COPY } from '@raven/wren'
import styles from '@/ui/StatusChip/StatusChip.module.scss'

type StatusChipProps = {
  /** The server's name. */
  name: string
  /** Whether the server answers: a green dot, or a red one, and the words for it. */
  isConnected: boolean
}

/** How each state is drawn and said: its dot's class and its words. */
const CHIP_STATES = {
  connected: { dot: styles.ok, wordsOf: STATUS_COPY.connected },
  unreachable: { dot: styles.down, wordsOf: STATUS_COPY.unreachable },
} as const

/**
 * A pill saying how a server is: its dot, its name and its state, the state said in words as
 * well as drawn, so a screen reader and a colour blind eye both hear it.
 */
export function StatusChip({ name, isConnected }: StatusChipProps) {
  const { dot, wordsOf } = isConnected ? CHIP_STATES.connected : CHIP_STATES.unreachable
  return (
    <p className={styles.chip}>
      <span className={classNames([styles.dot, dot])} />
      <span className={styles.label}>{wordsOf(name)}</span>
    </p>
  )
}
