import { create } from 'zustand'

/** How long a toast stays before it goes by itself. */
export const TOAST_MS = 5_000

export type Toast = { id: number; message: string }

type ToastsState = {
  toasts: readonly Toast[]
  /** The id the next toast gets. */
  nextId: number
  show: (message: string) => void
  dismiss: (id: number) => void
}

/**
 * Short notes that outlast the screen that raised them: Unplayable's
 * "Error reported" shows as the player closes. The host mounts one
 * `Toaster` above its routes to show them.
 */
export const useToasts = create<ToastsState>()((set) => ({
  toasts: [],
  nextId: 1,
  show: (message) =>
    set(({ toasts, nextId }) => ({
      toasts: [...toasts, { id: nextId, message }],
      nextId: nextId + 1,
    })),
  dismiss: (id) => set(({ toasts }) => ({ toasts: toasts.filter((toast) => toast.id !== id) })),
}))
