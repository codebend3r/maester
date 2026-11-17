import { create } from 'zustand'

import { MOTION } from '@/theme/wrenTokens'

type ToastState = {
  /** What the toast says, or null while none shows. */
  message: string | null
  /** Shows a message, in place of any showing, for a couple of seconds. */
  show: (message: string) => void
  hide: () => void
}

let hideTimer: ReturnType<typeof setTimeout> | null = null

/** The one toast every screen raises: "Added to Road trip". `ToastHost` draws it. */
export const useToast = create<ToastState>()((set) => ({
  message: null,
  show: (message) => {
    if (hideTimer !== null) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => set({ message: null }), MOTION.toast)
    set({ message })
  },
  hide: () => {
    if (hideTimer !== null) clearTimeout(hideTimer)
    hideTimer = null
    set({ message: null })
  },
}))

/** Says why something failed in the toast: an error's message, or whatever else was thrown. */
export const toastFailure = (error: unknown): void =>
  useToast.getState().show(error instanceof Error ? error.message : String(error))
