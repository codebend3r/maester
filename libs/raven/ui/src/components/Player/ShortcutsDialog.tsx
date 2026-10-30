import { shortcutRows } from '@raven/core'
import { useEffect, useId, useRef } from 'react'
import { Icon } from '@/components/Icon/Icon'
import { SHORTCUTS_DIALOG_COPY } from '@/components/Player/copy'
import { ShortcutList } from '@/components/Player/ShortcutList'
import styles from '@/components/Player/ShortcutsDialog.module.scss'

type ShortcutsDialogProps = {
  onClose: () => void
  canShowStats?: boolean
}

/**
 * The `?` list, as a modal <dialog>: the browser traps focus inside it and
 * lifts it above a full-screen stage. Escape, `?` again, or the close
 * button put it away.
 */
export const ShortcutsDialog = ({ onClose, canShowStats = false }: ShortcutsDialogProps) => {
  const heading = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const rows = shortcutRows({ canShowStats })

  useEffect(() => {
    const element = dialog.current
    // A test DOM's dialog may lack showModal or close, so each is checked before it is called.
    if (element !== null && !element.open && typeof element.showModal === 'function') {
      element.showModal()
    }
    return () => {
      if (element !== null && typeof element.close === 'function') element.close()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={heading}
      onCancel={(event) => {
        // The player's own Escape handling closes it, so the state stays in step.
        event.preventDefault()
        onClose()
      }}
    >
      <header className={styles.header}>
        <h2 id={heading} className={styles.heading}>
          {SHORTCUTS_DIALOG_COPY.heading}
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label={SHORTCUTS_DIALOG_COPY.close}
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <ShortcutList rows={rows} className={styles.list} />
    </dialog>
  )
}
