import { NOTIFICATION_TONES, type NotificationTone } from '@raven/core'
import { useEffect, useState } from 'react'
import { Button } from '@/components/Button/Button'
import { Icon } from '@/components/Icon/Icon'
import type { IconName } from '@/components/Icon/drawings'
import { TOASTER_COPY } from '@/components/Toaster/copy'
import styles from '@/components/Toaster/Toaster.module.scss'
import { TOAST_FADE_MS, TOAST_MS, type Toast, useToasts } from '@/stores/toasts'

type ToastNoteProps = { toast: Toast }

/** The mark each tone of toast wears beside its message, and of notification wherever it is listed. */
export const NOTIFICATION_ICONS = {
  [NOTIFICATION_TONES.success]: 'check',
  [NOTIFICATION_TONES.info]: 'bell',
  [NOTIFICATION_TONES.failure]: 'alert',
} as const satisfies Record<NotificationTone, IconName>

/** The class that colours each tone's mark and edge. */
const TONE_CLASSES = {
  [NOTIFICATION_TONES.success]: styles.success,
  [NOTIFICATION_TONES.info]: styles.info,
  [NOTIFICATION_TONES.failure]: styles.failure,
} as const satisfies Record<NotificationTone, string | undefined>

const ToastNote = ({ toast }: ToastNoteProps) => {
  const dismiss = useToasts((state) => state.dismiss)
  const [isLeaving, setLeaving] = useState(false)
  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), TOAST_MS - TOAST_FADE_MS)
    const timer = setTimeout(() => dismiss(toast.id), TOAST_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(timer)
    }
  }, [toast.id, dismiss])
  return (
    // An output holds phrasing content only, so each toast is a span.
    <span
      className={[styles.toast, TONE_CLASSES[toast.tone], isLeaving ? styles.leaving : '']
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.mark}>
        <Icon name={NOTIFICATION_ICONS[toast.tone]} />
      </span>
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
