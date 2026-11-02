import { DESKTOP_PATHS, isPagePath, object, oneOf, PAGE_PATHS } from '@raven/core'
import { generatePath, matchPath } from 'react-router-dom'
import { MUSIC_PATHS, isMusicPath } from '@/lib/music'

/** A local file or download playing, by the id main granted for it. */
export const playPathOf = (fileId: string): string => generatePath(DESKTOP_PATHS.play, { fileId })

/** What Raven shows while its server cannot be reached: nothing that needs the server. */
const OFFLINE_PAGES = [
  DESKTOP_PATHS.downloads,
  MUSIC_PATHS.downloads,
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

/** Raven's Downloads page in each mode: its own, and the music mode's. */
const DOWNLOADS_PAGES = [DESKTOP_PATHS.downloads, MUSIC_PATHS.downloads] as const

export const isDownloadsPage = oneOf(DOWNLOADS_PAGES)

export type DownloadsPage = (typeof DOWNLOADS_PAGES)[number]

/** The Downloads page of the mode `pathname` is in: the music mode's under `/music`, raven's elsewhere. */
export const downloadsPageFor = (pathname: string): DownloadsPage =>
  isMusicPath(pathname) ? MUSIC_PATHS.downloads : DESKTOP_PATHS.downloads

const isPlayOrigin = object({ from: isDownloadsPage })

type PlayOriginForProps = { state: unknown; pathname: string }

/**
 * The Downloads a file playing goes back to, from the route state that opened it: kept from a
 * file that was playing, else the one of the mode the opening page was in.
 */
export const playOriginFor = ({ state, pathname }: PlayOriginForProps): DownloadsPage =>
  isPlayOrigin(state) ? state.from : downloadsPageFor(pathname)

const isOfflineReturn = object({ returnTo: isPagePath })

/** The route state of the offline redirect: the page asked for, to go back to once the server answers. */
export const offlineReturnOf = (returnTo: string) => ({ returnTo })

/** The page the offline redirect left, from the route state it put on Downloads; null for any other. */
export const offlineReturnIn = (state: unknown): string | null =>
  isOfflineReturn(state) ? state.returnTo : null
