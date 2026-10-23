import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

type HoverBackdrops = {
  /**
   * Whether the cards bring their pictures in behind the page. A page with a
   * backdrop of its own, as a saga's has, turns it off while it is up, so
   * pointing at a card leaves that backdrop alone.
   */
  isOn: boolean
}

export const useHoverBackdrops = create<HoverBackdrops>()(
  devtools(
    persist((): HoverBackdrops => ({ isOn: true }), {
      name: STORE_KEYS.hoverBackdrops,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ isOn }) => ({ isOn }),
    }),
    { name: 'raven/hoverBackdrops' },
  ),
)
