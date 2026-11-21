import { create } from 'zustand'

/** How long a toast stays, in milliseconds: the apps' `MOTION.toast`. */
export const TOAST_MS = 2400

type ToastState = {
  /** What the toast says, or null while none shows. */
  message: string | null
  /** Shows a message, in place of any showing, for a couple of seconds. */
  show: (message: string) => void
  hide: () => void
}

type Timer = { hide: ReturnType<typeof setTimeout> | null }

const timer: Timer = { hide: null }

const stopTimer = (): void => {
  if (timer.hide !== null) clearTimeout(timer.hide)
  timer.hide = null
}

/** The one toast every screen raises: "Added to Road trip". `ToastHost` draws it. */
export const useToast = create<ToastState>()((set) => ({
  message: null,
  show: (message) => {
    stopTimer()
    timer.hide = setTimeout(() => set({ message: null }), TOAST_MS)
    set({ message })
  },
  hide: () => {
    stopTimer()
    set({ message: null })
  },
}))

/** Says why something failed in the toast: an error's message, or whatever else was thrown. */
export const toastFailure = (error: unknown): void =>
  useToast.getState().show(error instanceof Error ? error.message : String(error))
