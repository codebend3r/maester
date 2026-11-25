import { KIT_COPY } from '@raven/wren'
import { WrenMark } from '@/components/WrenLockup/WrenLockup'
import type { Size, TokenStyle } from '@/theme/tokens'
import styles from '@/components/LoadingMark/LoadingMark.module.scss'

type LoadingMarkProps = {
  /** How wide the bird is drawn; the ring turns around it. */
  size: Size
  /** What is loading, said aloud; "Loading" when left out. */
  label?: string
}

/**
 * Wren's mark with a ring turning around it, for anything on its way. The words are for a
 * screen reader alone: Wren never shows loading as plain text.
 */
export function LoadingMark({ size, label = KIT_COPY.loading }: LoadingMarkProps) {
  const style: TokenStyle = { '--loading-mark-size': size }
  return (
    <output aria-live="polite" className={styles.loading} style={style}>
      <span aria-hidden="true" className={styles.ring} />
      <span aria-hidden="true" className={styles.mark}>
        <WrenMark size={size} />
      </span>
      <span className={styles.label}>{label}</span>
    </output>
  )
}
