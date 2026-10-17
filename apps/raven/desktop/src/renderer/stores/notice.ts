import { create } from 'zustand'

type Notice = {
  /** What the Shell's live region says, a new object each time so the same words count again. */
  notice: { message: string } | null
  show: (message: string) => void
  clear: () => void
}

/** Says something in the Shell's live region, which outlasts the page that said it. */
export const useNotice = create<Notice>()((set) => ({
  notice: null,
  show: (message) => set({ notice: { message } }),
  clear: () => set({ notice: null }),
}))
