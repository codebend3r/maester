import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

type WindowChromeState = {
  /** False while the player has hidden its own controls, so the window's hide with them. */
  isShown: boolean
  setShown: (isShown: boolean) => void
}

/** Whether the page-drawn window controls show: the player's chrome reports it, as macOS hides its traffic lights. */
export const useWindowChrome = create<WindowChromeState>()(
  devtools(
    (set) => ({
      isShown: true,
      setShown: (isShown) => set({ isShown }),
    }),
    { name: 'raven/windowChrome' },
  ),
)
