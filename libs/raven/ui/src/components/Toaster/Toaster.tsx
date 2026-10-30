import { useEffect } from 'react'
import { Button } from '@/components/Button/Button'
import { Icon } from '@/components/Icon/Icon'
import { TOASTER_COPY } from '@/components/Toaster/copy'
import styles from '@/components/Toaster/Toaster.module.scss'
import { TOAST_MS, type Toast, useToasts } from '@/stores/toasts'

type ToastNoteProps = { toast: Toast }

const ToastNote = ({ toast }: ToastNoteProps) => {
  const dismiss = useToasts((state) => state.dismiss)
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast.id, dismiss])
  return (
    // An output holds phrasing content only, so each toast is a span.
    <span className={styles.toast}>
      <Icon name="check" />
      <span className={styles.message}>{toast.message}</span>
      <Button
        tone="ghost"
        icon="close"
        className={styles.dismiss}
        aria-label={TOASTER_COPY.dismiss}
        onClick={() => dismiss(toast.id)}
      />
    </span>
  )
}

/**
 * Where toasts show, at the top of the screen over any page and the player.
 * The live region is always there, so a toast added to it is read out.
 */
export const Toaster = () => {
  const toasts = useToasts((state) => state.toasts)
  return (
    <output className={styles.toaster} aria-live="polite">
      {toasts.map((toast) => (
        <ToastNote key={toast.id} toast={toast} />
      ))}
    </output>
  )
}
