import { KIT_COPY } from '@raven/wren'
import { SIZES } from '@/theme/tokens'
import { WrenMark } from '@/components/WrenLockup/WrenLockup'
import styles from '@/shell/Loading/Loading.module.scss'

/** What shows while the account or a page's code is on its way: the mark, and "Loading" said aloud. */
export function Loading() {
  return (
    <output aria-live="polite" className={styles.loading}>
      <WrenMark size={SIZES.signInMark} />
      <span className={styles.label}>{KIT_COPY.loading}</span>
    </output>
  )
}
