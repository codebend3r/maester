import { useCallback, useSyncExternalStore } from 'react'

/** The media queries code follows, each the stylesheets' own threshold. */
export const MEDIA_QUERIES = {
  /** The narrow layout, the apps' phone's, holds up to this width; the stylesheets' `48rem` too. */
  phone: '(max-width: 48rem)',
  /*
   * Up to `64rem` the sidebar is a rail of icons whatever its toggle says, and Now Playing keeps
   * the phone's panes: the player's column, 30% of the width, is too narrow for the transport
   * under it, as an upright tablet's is in the apps. The stylesheets' `64rem` too.
   */
  rail: '(max-width: 64rem)',
  /** The device's light scheme. */
  light: '(prefers-color-scheme: light)',
} as const

export type MediaQuery = (typeof MEDIA_QUERIES)[keyof typeof MEDIA_QUERIES]

const MEDIA_EVENTS = { change: 'change' } as const

type FollowMediaProps = {
  query: MediaQuery
  onChange: () => void
}

/** Tells `onChange` each time `query` starts or stops matching. Returns the way to stop. */
export const followMedia = ({ query, onChange }: FollowMediaProps): (() => void) => {
  const media = window.matchMedia(query)
  media.addEventListener(MEDIA_EVENTS.change, onChange)
  return () => media.removeEventListener(MEDIA_EVENTS.change, onChange)
}

type MatchesMediaProps = { query: MediaQuery }

/** Whether `query` matches now. */
export const matchesMedia = ({ query }: MatchesMediaProps): boolean =>
  window.matchMedia(query).matches

/** Whether `query` matches, followed as the window or the device changes. */
export const useMatchesMedia = ({ query }: MatchesMediaProps): boolean => {
  const subscribe = useCallback((onChange: () => void) => followMedia({ query, onChange }), [query])
  return useSyncExternalStore(subscribe, () => matchesMedia({ query }))
}
