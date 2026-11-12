import { DESKTOP_REPLIES, DESKTOP_REQUESTS, type DesktopReply } from '@raven/core'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import type { BrowserDownloads } from '@/browserDownloads/engine'
import { BROWSER_OFFLINE_PAGES, browserPlayPathOf } from '@/browserDownloads/paths'
import { DOWNLOADS_HOSTS, type DownloadsHost, type DownloadsRequest } from '@/downloads/host'

const refused = (message: string): DesktopReply => ({ type: DESKTOP_REPLIES.refused, message })

const DONE = { type: DESKTOP_REPLIES.done } as const satisfies DesktopReply

/**
 * The browser's downloads behind the desktop's protocol: each request the page sends Raven's
 * main is answered here from the engine, with the reply main would give.
 */
export const browserDownloadsHost = (engine: BrowserDownloads): DownloadsHost => {
  const listed = (): DesktopReply => ({
    type: DESKTOP_REPLIES.downloads,
    downloads: engine.list(),
    shouldAutoDeleteByDefault: false,
  })

  const answer = async (request: DownloadsRequest): Promise<DesktopReply> => {
    switch (request.type) {
      case DESKTOP_REQUESTS.askDownload: {
        const asked = await engine.ask(request.target)
        return asked.ok
          ? { type: DESKTOP_REPLIES.downloadAsk, ask: asked.value }
          : refused(asked.message)
      }
      case DESKTOP_REQUESTS.confirmDownload: {
        const confirmed = engine.confirm(request.askId)
        return confirmed.ok ? listed() : refused(confirmed.message)
      }
      case DESKTOP_REQUESTS.declineDownload:
        engine.decline(request.askId)
        return DONE
      case DESKTOP_REQUESTS.listDownloads:
        return listed()
      case DESKTOP_REQUESTS.openDownload: {
        const playable = engine.playable(request.downloadId)
        return playable.ok
          ? { type: DESKTOP_REPLIES.navigate, to: browserPlayPathOf(request.downloadId) }
          : refused(playable.message)
      }
      case DESKTOP_REQUESTS.readSpace:
        return { type: DESKTOP_REPLIES.space, space: await engine.space() }
      case DESKTOP_REQUESTS.pauseDownload:
        engine.pause(request.downloadId)
        return listed()
      case DESKTOP_REQUESTS.resumeDownload:
      case DESKTOP_REQUESTS.retryDownload:
        engine.resume(request.downloadId)
        return listed()
      case DESKTOP_REQUESTS.deleteDownload:
        await engine.remove(request.downloadId)
        return listed()
      case DESKTOP_REQUESTS.pauseAllDownloads:
        engine.pauseAll()
        return listed()
      case DESKTOP_REQUESTS.resumeAllDownloads:
        engine.resumeAll()
        return listed()
      case DESKTOP_REQUESTS.deleteAllDownloads:
        await engine.removeAll()
        return listed()
      // What the browser's abilities leave out, so the page never asks: no folder, no auto-delete.
      case DESKTOP_REQUESTS.setDownloadAutoDelete:
      case DESKTOP_REQUESTS.setDownloadDefaults:
      case DESKTOP_REQUESTS.showDownloadsFolder:
        return refused(BROWSER_DOWNLOAD_COPY.unsupported)
      default: {
        const unreachable: never = request
        return unreachable
      }
    }
  }

  return {
    kind: DOWNLOADS_HOSTS.browser,
    canKeepMusic: false,
    canShowFolder: false,
    canAutoDelete: false,
    canKeepDolbyVision: engine.canKeepDolbyVision,
    offlinePages: BROWSER_OFFLINE_PAGES,
    request: async (request) => {
      try {
        return await answer(request)
      } catch {
        return refused(BROWSER_DOWNLOAD_COPY.unreachable)
      }
    },
    pictureUrl: engine.pictureUrl,
  }
}
