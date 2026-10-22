import { DESKTOP_PATHS, isPagePath, object, PAGE_PATHS } from '@raven/core'
import { generatePath, matchPath } from 'react-router-dom'

/** A local file or download playing, by the id main granted for it. */
export const playPathOf = (fileId: string): string => generatePath(DESKTOP_PATHS.play, { fileId })

/** What raven player shows while its server cannot be reached: nothing that needs the server. */
const OFFLINE_PAGES = [
  DESKTOP_PATHS.downloads,
  DESKTOP_PATHS.local,
  DESKTOP_PATHS.play,
  PAGE_PATHS.settings,
] as const

export const isOfflinePage = (pathname: string): boolean =>
  OFFLINE_PAGES.some((pattern) => matchPath(pattern, pathname) !== null)

/** Whether a local file or a download is playing: a page that needs neither server nor account. */
export const isFilePlaying = (pathname: string): boolean =>
  matchPath(DESKTOP_PATHS.play, pathname) !== null

/** Whether a video is on screen, so the next one replaces it in history rather than stacking. */
export const isPlaying = (pathname: string): boolean =>
  isFilePlaying(pathname) || matchPath(`${PAGE_PATHS.watch}/:id`, pathname) !== null

const isOfflineReturn = object({ returnTo: isPagePath })

/** The route state of the offline redirect: the page asked for, to go back to once the server answers. */
export const offlineReturnOf = (returnTo: string) => ({ returnTo })

/** The page the offline redirect left, from the route state it put on Downloads; null for any other. */
export const offlineReturnIn = (state: unknown): string | null =>
  isOfflineReturn(state) ? state.returnTo : null
