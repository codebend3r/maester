import { NOTIFICATION_TONES, type Notification, type NotificationTone } from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { localOrMemoryStorage } from '@/stores/browserStorage'
import { STORE_KEYS } from '@/stores/storage'

/** How long a toast stays before it goes by itself, long enough to read a few in a row. */
export const TOAST_MS = 15_000

/** How long a toast takes to fade, at the end of its `TOAST_MS`; `Toaster.module.scss` matches it. */
export const TOAST_FADE_MS = 600

export type Toast = {
  id: number
  message: string
  tone: NotificationTone
  /**
   * Whether the server logged it already, as it does a notification it
   * sends; a toast a screen raises itself is not, and the host logs it.
   */
  isLogged: boolean
}

type ToastsState = {
  toasts: readonly Toast[]
  /** The id the next toast gets. */
  nextId: number
  /** A note this screen raises: a confirmation of what was just done. */
  show: (message: string) => void
  /** A notification the server logged and sent, shown as it came. */
  showNotification: (notification: Notification) => void
  dismiss: (id: number) => void
}

/**
 * Short notes that outlast the screen that raised them: Unplayable's
 * "Error reported" shows as the player closes, and smart match's outcomes
 * as the server sends them. The host mounts one `Toaster` above its routes
 * to show them, stacked, and logs the ones not logged yet.
 */
export const useToasts = create<ToastsState>()(
  devtools(
    persist(
      (set) => ({
        toasts: [],
        nextId: 1,
        show: (message) =>
          set(({ toasts, nextId }) => ({
            toasts: [
              ...toasts,
              { id: nextId, message, tone: NOTIFICATION_TONES.success, isLogged: false },
            ],
            nextId: nextId + 1,
          })),
        showNotification: ({ message, tone }) =>
          set(({ toasts, nextId }) => ({
            toasts: [...toasts, { id: nextId, message, tone, isLogged: true }],
            nextId: nextId + 1,
          })),
        dismiss: (id) =>
          set(({ toasts }) => ({ toasts: toasts.filter((toast) => toast.id !== id) })),
      }),
      {
        name: STORE_KEYS.toasts,
        storage: createJSONStorage(localOrMemoryStorage),
        // A toast belongs to the launch that raised it; kept, the next launch would show it again.
        partialize: ({ nextId }) => ({ nextId }),
      },
    ),
    { name: 'raven/toasts' },
  ),
)
