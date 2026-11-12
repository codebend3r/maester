import { DESKTOP_REPLIES, DESKTOP_REQUESTS, pictureUrlFor } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { DESKTOP_OFFLINE_PAGES } from '@/desktop/paths'
import { desktopDownloadsHost } from '@/downloads/desktopHost'
import { DOWNLOADS_HOSTS } from '@/downloads/host'
import { DL_1, downloadsMain, viewOf } from '@/test/desktop'

describe('desktopDownloadsHost', () => {
  it("hands every request to main as it is, and main's reply back", async () => {
    const client = downloadsMain({ downloads: [viewOf()] })
    const host = desktopDownloadsHost(client)
    const request = { type: DESKTOP_REQUESTS.pauseDownload, downloadId: DL_1 } as const
    const reply = await host.request(request)
    expect(client.request).toHaveBeenCalledWith(request)
    expect(reply).toMatchObject({ type: DESKTOP_REPLIES.downloads })
    expect(client.request).toHaveBeenCalledTimes(1)
  })

  it('does everything Raven does, and reads a saved picture by its scheme', () => {
    const host = desktopDownloadsHost(downloadsMain())
    expect(host.kind).toBe(DOWNLOADS_HOSTS.desktop)
    expect(host).toMatchObject({
      canKeepMusic: true,
      canShowFolder: true,
      canAutoDelete: true,
      canKeepDolbyVision: true,
    })
    expect(host.offlinePages).toBe(DESKTOP_OFFLINE_PAGES)
    expect(host.pictureUrl(DL_1)).toBe(pictureUrlFor(DL_1))
  })
})
