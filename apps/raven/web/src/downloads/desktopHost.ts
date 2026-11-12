import { pictureUrlFor } from '@raven/core'
import type { DesktopClient } from '@/desktop/client'
import { DESKTOP_OFFLINE_PAGES } from '@/desktop/paths'
import { DOWNLOADS_HOSTS, type DownloadsHost } from '@/downloads/host'

/** Raven's downloads: main keeps them, so every request goes to it as it is. */
export const desktopDownloadsHost = (client: DesktopClient): DownloadsHost => ({
  kind: DOWNLOADS_HOSTS.desktop,
  canKeepMusic: true,
  canShowFolder: true,
  canAutoDelete: true,
  canKeepDolbyVision: true,
  offlinePages: DESKTOP_OFFLINE_PAGES,
  request: (request) => client.request(request),
  pictureUrl: pictureUrlFor,
})
