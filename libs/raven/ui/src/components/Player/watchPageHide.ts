import type { WatchHide } from '@/components/Player/useProgressReport'

const PAGE_EVENTS = { hide: 'pagehide' } as const

/** A web page's hide: the tab closed, reloaded or sent away, when the spot must be saved at once. */
export const watchPageHide: WatchHide = (save) => {
  window.addEventListener(PAGE_EVENTS.hide, save)
  return () => window.removeEventListener(PAGE_EVENTS.hide, save)
}
