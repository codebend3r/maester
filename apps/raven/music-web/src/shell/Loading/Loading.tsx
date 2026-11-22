import { LoadingMark } from '@/components/LoadingMark/LoadingMark'
import { SIZES } from '@/theme/tokens'
import styles from '@/shell/Loading/Loading.module.scss'

/** What shows while the account or a page's code is on its way: the mark with a ring turning around it. */
export function Loading() {
  return (
    <section className={styles.loading}>
      <LoadingMark size={SIZES.signInMark} />
    </section>
  )
}
