import { useEffect, useId, useRef } from 'react'
import { Icon } from '@/components/Icon/Icon'
import styles from '@/components/Player/ShortcutsDialog.module.scss'
import { SHORTCUT_LIST } from '@/lib/shortcuts'

/**
 * The `?` list, as a modal <dialog>: the browser traps focus inside it and
 * lifts it above a full-screen stage. Escape, `?` again, or the close
 * button put it away.
 */
export const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => {
  const heading = useId()
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal?.()
    return () => element?.close?.()
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
        {SHORTCUT_LIST.map(({ keys, action }) => (
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
