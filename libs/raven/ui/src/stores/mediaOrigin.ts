import { MEDIA_ORIGIN_KINDS, type MediaOrigin } from '@raven/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/** Where media plays from (null plays through the web host's own address), and when the host set it (epoch ms). */
export type MediaPick = {
  origin: MediaOrigin | null
  at: number
}

type MediaOriginState = {
  /** The host's pick; null until the host sets one. */
  pick: MediaPick | null
  setPick: (pick: MediaPick | null) => void
}

/**
 * The media origin the host sets as it starts. Nothing probes or falls
 * back: a host that names an origin plays every video and track from it,
 * and one that names none plays through its own address.
 */
export const useMediaOrigin = create<MediaOriginState>()(
  devtools(
    (set) => ({
      pick: null,
      setPick: (pick) => set({ pick }),
    }),
    { name: 'raven/mediaOrigin' },
  ),
)

type MediaOriginOfProps = {
  /** raven's origin when the page's `/api` is a proxy to it; '' when `/api` is raven itself. */
  apiOrigin: string
}

/**
 * Where a page's video and music come from: raven's public origin when its `/api` is a proxy, so
 * media never travels through the proxy (whose host bills it as bandwidth), and null, the page's
 * own `/api`, when that is raven itself.
 */
export const mediaOriginOf = ({ apiOrigin }: MediaOriginOfProps): MediaOrigin | null =>
  apiOrigin === '' ? null : { kind: MEDIA_ORIGIN_KINDS.public, url: apiOrigin }

/**
 * Names a page's media origin before anything plays, with no request: nothing is probed and
 * nothing falls back to the proxy. A page whose `/api` is raven itself names none.
 */
export const startMediaOrigin = ({ apiOrigin }: MediaOriginOfProps): void => {
  const origin = mediaOriginOf({ apiOrigin })
  if (origin === null) return
  useMediaOrigin.getState().setPick({ origin, at: Date.now() })
}
