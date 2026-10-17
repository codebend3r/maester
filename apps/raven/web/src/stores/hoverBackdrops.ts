import { create } from 'zustand'

type HoverBackdrops = {
  /**
   * Whether the cards bring their pictures in behind the page. A page with a
   * backdrop of its own, as a saga's has, turns it off while it is up, so
   * pointing at a card leaves that backdrop alone.
   */
  isOn: boolean
}

export const useHoverBackdrops = create<HoverBackdrops>()(() => ({ isOn: true }))
