import type { DESKTOP_REQUESTS, DesktopReply, DesktopRequest } from '@raven/core'

/** Who keeps the downloads: Raven's main process, or the browser itself. */
export const DOWNLOADS_HOSTS = { desktop: 'desktop', browser: 'browser' } as const

export type DownloadsHostKind = (typeof DOWNLOADS_HOSTS)[keyof typeof DOWNLOADS_HOSTS]

/** What the Downloads page and Settings ask a host to change. */
export type DownloadsChange = Extract<
  DesktopRequest,
  {
    type:
      | typeof DESKTOP_REQUESTS.pauseDownload
      | typeof DESKTOP_REQUESTS.resumeDownload
      | typeof DESKTOP_REQUESTS.retryDownload
      | typeof DESKTOP_REQUESTS.deleteDownload
      | typeof DESKTOP_REQUESTS.setDownloadAutoDelete
      | typeof DESKTOP_REQUESTS.pauseAllDownloads
      | typeof DESKTOP_REQUESTS.resumeAllDownloads
      | typeof DESKTOP_REQUESTS.deleteAllDownloads
      | typeof DESKTOP_REQUESTS.setDownloadDefaults
      | typeof DESKTOP_REQUESTS.showDownloadsFolder
  }
>

/** Everything the page asks of its downloads, in the words of the desktop's protocol. */
export type DownloadsRequest =
  | DownloadsChange
  | Extract<
      DesktopRequest,
      {
        type:
          | typeof DESKTOP_REQUESTS.askDownload
          | typeof DESKTOP_REQUESTS.confirmDownload
          | typeof DESKTOP_REQUESTS.declineDownload
          | typeof DESKTOP_REQUESTS.listDownloads
          | typeof DESKTOP_REQUESTS.openDownload
          | typeof DESKTOP_REQUESTS.readSpace
      }
    >

/**
 * The page's one door to its downloads, whoever keeps them. Every host answers the desktop's
 * protocol, so the Downloads page, the dialog, the button and Settings are written once.
 */
export type DownloadsHost = {
  kind: DownloadsHostKind
  /** Albums and playlists download too, and the music mode has a Downloads page. */
  canKeepMusic: boolean
  /** The downloads sit in a folder the system's file manager can show. */
  canShowFolder: boolean
  /** A download can delete itself once it is watched. */
  canAutoDelete: boolean
  /** A Dolby Vision only title downloads here; where it does not, Download is greyed out. */
  canKeepDolbyVision: boolean
  /** The route patterns the host shows while the server is out of reach. */
  offlinePages: readonly string[]
  request: (request: DownloadsRequest) => Promise<DesktopReply>
  /** Where the page reads a saved picture from, by its opaque id; null while it cannot. */
  pictureUrl: (pictureId: string) => string | null
}
