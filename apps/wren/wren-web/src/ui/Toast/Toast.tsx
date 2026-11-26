import { WREN_ICONS } from '@raven/wren'
import { SIZES } from '@/theme/tokens'
import { useToast } from '@/stores/toast'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/Toast/Toast.module.scss'

/**
 * The toast `useToast` raises, over every screen, said aloud as it shows. The shell sets it in
 * its foot, so it floats clear of whichever bars show. It fades in, or simply shows for a
 * listener who asked for less motion.
 */
export function ToastHost() {
  const message = useToast((state) => state.message)
  return (
    <output aria-live="polite" className={styles.host}>
      {message !== null && (
        <span className={styles.toast}>
          <WrenIcon name={WREN_ICONS.check} size={SIZES.smallIcon} />
          <span className={styles.message}>{message}</span>
        </span>
      )}
    </output>
  )
}
