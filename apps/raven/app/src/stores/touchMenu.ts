import { create } from 'zustand'

type TouchMenu = {
  /** Whether the side menu of a phone or tablet is slid out over the page. */
  isOpen: boolean
  open: () => void
  close: () => void
}

/** The side menu on a phone or tablet: out or in, shared by the headers that open it and the drawer. */
export const useTouchMenu = create<TouchMenu>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}))
