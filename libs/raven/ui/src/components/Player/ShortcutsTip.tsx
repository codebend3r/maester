import { essentialShortcutRows } from '@raven/core'
import { useId } from 'react'
import { Button } from '@/components/Button/Button'
import { SHORTCUTS_TIP_COPY } from '@/components/Player/copy'
import { ShortcutList } from '@/components/Player/ShortcutList'
import styles from '@/components/Player/ShortcutsTip.module.scss'

type ShortcutsTipProps = { onDismiss: () => void }

/**
 * The tip a viewer's first video opens with: the few keys that matter most,
 * and `?` for the rest. It never takes focus, so the keys it teaches work
 * while it shows, and it stays until Got it, `?` or the player closes.
 */
export const ShortcutsTip = ({ onDismiss }: ShortcutsTipProps) => {
  const heading = useId()
  return (
    <div className={styles.layer}>
      <aside className={styles.tip} aria-labelledby={heading}>
        <h2 id={heading} className={styles.heading}>
          {SHORTCUTS_TIP_COPY.heading}
        </h2>
        <ShortcutList rows={essentialShortcutRows()} className={styles.list} />
        <Button tone="ghost" className={styles.dismiss} onClick={onDismiss}>
          {SHORTCUTS_TIP_COPY.dismiss}
        </Button>
      </aside>
    </div>
  )
}
