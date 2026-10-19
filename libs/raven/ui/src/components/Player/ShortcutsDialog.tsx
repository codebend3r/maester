import { shortcutRows } from '@raven/core'
import { useEffect, useId, useRef } from 'react'
import { Icon } from '@/components/Icon/Icon'
import styles from '@/components/Player/ShortcutsDialog.module.scss'

/**
 * The `?` list, as a modal <dialog>: the browser traps focus inside it and
 * lifts it above a full-screen stage. Escape, `?` again, or the close
 * button put it away.
 */
export const ShortcutsDialog = ({
  onClose,
  canShowStats = false,
}: {
  onClose: () => void
  canShowStats?: boolean
}) => {
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
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Close shortcuts"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <dl className={styles.list}>
        {rows.map(({ keys, action }) => (
          <div key={action} className={styles.row}>
            <dt className={styles.keys}>
              {keys.map((key) => (
                <kbd key={key} className={styles.key}>
                  {key}
                </kbd>
              ))}
            </dt>
            <dd className={styles.action}>{action}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  )
}
