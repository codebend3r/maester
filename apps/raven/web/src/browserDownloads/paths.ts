import { DESKTOP_PATHS, PAGE_PATHS } from '@raven/core'
import { generatePath } from 'react-router-dom'

/** A download playing in the browser's own player, by its id. */
export const BROWSER_PLAY_PATH = `${DESKTOP_PATHS.downloads}/play/:downloadId` as const

export const browserPlayPathOf = (downloadId: string): string =>
  generatePath(BROWSER_PLAY_PATH, { downloadId })

/** A title's watch page, which plays its download when the server is out of reach. */
const WATCH_ROUTE = `${PAGE_PATHS.watch}/:id`

/** What the browser shows while the server is out of reach: nothing that needs it. */
export const BROWSER_OFFLINE_PAGES = [
  DESKTOP_PATHS.downloads,
  BROWSER_PLAY_PATH,
  WATCH_ROUTE,
  PAGE_PATHS.settings,
] as const
