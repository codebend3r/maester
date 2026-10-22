import type { PlayerActivity } from '@/main/player/playerService'

/** Electron reads `#AARRGGBB`; zero alpha lets the video under the page show through. */
export const CLEAR = '#00000000'

/**
 * Splits the service's activity: whether it plays goes to the sleep guard every time,
 * whether a video shows goes to the window only when it changes. Nothing shows at first.
 * `hide` forces the window back for a page with no video: a new or crashed page shows none,
 * even when the service, already idle or dead, has nothing to report.
 */
export const createActivity = ({
  onPlaying,
  onShowing,
}: {
  onPlaying: (isPlaying: boolean) => void
  onShowing: (isShowing: boolean) => void
}): { report: (activity: PlayerActivity) => void; hide: () => void } => {
  let isShowing = false
  return {
    report: (activity) => {
      onPlaying(activity.isPlaying)
      if (activity.isShowing === isShowing) return
      isShowing = activity.isShowing
      onShowing(isShowing)
    },
    hide: () => {
      isShowing = false
      onPlaying(false)
      onShowing(false)
    },
  }
}
