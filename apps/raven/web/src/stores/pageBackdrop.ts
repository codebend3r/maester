import { create } from 'zustand'

/** How many pictures stay laid out, so one fading out finishes while the next fades in. */
const KEPT = 4

type PageBackdrop = {
  /** The picture asked for now, or null for none. */
  current: string | null
  /**
   * The picture behind the page now: the one asked for once it has loaded,
   * else the one before it, left up until the two can cross fade.
   */
  shown: string | null
  /** The pictures shown lately, the current one last, kept for their fade. */
  recent: readonly string[]
  /** Those of `recent` that have loaded. */
  loaded: readonly string[]
  show: (url: string) => void
  /** Puts `url` away if it is the one asked for; a picture asked for since stays. */
  hide: (url: string) => void
  markLoaded: (url: string) => void
}

/** The picture of whatever card is pointed at or focused, faded in behind the whole page. */
export const usePageBackdrop = create<PageBackdrop>()((set) => ({
  current: null,
  shown: null,
  recent: [],
  loaded: [],
  show: (url) =>
    set((state) => {
      const recent = [...state.recent.filter((kept) => kept !== url), url].slice(-KEPT)
      const loaded = state.loaded.filter((each) => recent.includes(each))
      const held = state.shown != null && recent.includes(state.shown) ? state.shown : null
      return { current: url, recent, loaded, shown: loaded.includes(url) ? url : held }
    }),
  hide: (url) => set((state) => (state.current === url ? { current: null, shown: null } : state)),
  markLoaded: (url) =>
    set((state) =>
      !state.recent.includes(url) || state.loaded.includes(url)
        ? state
        : {
            loaded: [...state.loaded, url],
            shown: state.current === url ? url : state.shown,
          },
    ),
}))
