import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_STATUS_KINDS,
  DOWNLOAD_TARGET_KINDS,
  isDesktopReply,
  CONTAINERS,
} from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { waitFor } from '@testing-library/react'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import { browserDownloadsHost } from '@/browserDownloads/host'
import { BROWSER_OFFLINE_PAGES, browserPlayPathOf } from '@/browserDownloads/paths'
import { DOWNLOADS_HOSTS } from '@/downloads/host'
import { bytesOfLength, fakeEngine, fakeServer, stuckAnswer } from '@/test/browserDownloads'
import { mediaItem } from '@/test/fixtures'

const MOVIE = mediaItem({ id: 7, container: CONTAINERS.mp4, size: 10, item: null })
const TARGET = { kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 } as const

const hosted = async (server = fakeServer({ media: [MOVIE], files: { 7: bytesOfLength(10) } })) => {
  const fake = await fakeEngine({ server })
  return { ...fake, host: browserDownloadsHost(fake.engine) }
}

type Host = Awaited<ReturnType<typeof hosted>>['host']

/** Asks and confirms through the host, as the button and the dialog do; answers the list. */
const download = async (host: Host) => {
  const asked = await host.request({ type: DESKTOP_REQUESTS.askDownload, target: TARGET })
  if (asked.type !== DESKTOP_REPLIES.downloadAsk) throw new Error('The host did not ask.')
  return host.request({
    type: DESKTOP_REQUESTS.confirmDownload,
    askId: asked.ask.askId,
    shouldAutoDelete: false,
  })
}

/** The requests that change one download's status and answer the list. */
type StatusRequest = (typeof DESKTOP_REQUESTS)['pauseDownload' | 'resumeDownload' | 'retryDownload']

const listOf = async (host: Host) => {
  const reply = await host.request({ type: DESKTOP_REQUESTS.listDownloads })
  if (reply.type !== DESKTOP_REPLIES.downloads) throw new Error('The host did not list.')
  return reply.downloads
}

describe('browserDownloadsHost', () => {
  it('is a host that keeps videos only, with no folder to show and no auto-delete', async () => {
    const { host } = await hosted()
    expect(host.kind).toBe(DOWNLOADS_HOSTS.browser)
    expect(host).toMatchObject({
      canKeepMusic: false,
      canShowFolder: false,
      canAutoDelete: false,
      canKeepDolbyVision: true,
    })
    expect(host.offlinePages).toBe(BROWSER_OFFLINE_PAGES)
  })

  it("answers an ask and its confirmation in the protocol's own replies", async () => {
    const { host } = await hosted()
    const reply = await download(host)
    expect(isDesktopReply(reply)).toBe(true)
    expect(reply).toMatchObject({
      type: DESKTOP_REPLIES.downloads,
      shouldAutoDeleteByDefault: false,
      downloads: [{ label: MOVIE.title, shouldAutoDelete: false, track: null }],
    })
  })

  it('refuses with why when the title cannot be listed, or the ask is gone', async () => {
    const { host } = await hosted(fakeServer())
    expect(await host.request({ type: DESKTOP_REQUESTS.askDownload, target: TARGET })).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: BROWSER_DOWNLOAD_COPY.unreachable,
    })
    expect(
      await host.request({
        type: DESKTOP_REQUESTS.confirmDownload,
        askId: '0c000000-0000-4000-8000-000000000001',
        shouldAutoDelete: false,
      }),
    ).toEqual({ type: DESKTOP_REPLIES.refused, message: BROWSER_DOWNLOAD_COPY.askGone })
  })

  it('lets a declined ask go', async () => {
    const { host } = await hosted()
    const asked = await host.request({ type: DESKTOP_REQUESTS.askDownload, target: TARGET })
    if (asked.type !== DESKTOP_REPLIES.downloadAsk) throw new Error('The host did not ask.')
    const { askId } = asked.ask
    expect(await host.request({ type: DESKTOP_REQUESTS.declineDownload, askId })).toEqual({
      type: DESKTOP_REPLIES.done,
    })
    expect(
      await host.request({
        type: DESKTOP_REQUESTS.confirmDownload,
        askId,
        shouldAutoDelete: false,
      }),
    ).toMatchObject({ type: DESKTOP_REPLIES.refused })
  })

  it('sends a ready download to its player, and says why any other will not play', async () => {
    const { host } = await hosted()
    await download(host)
    await waitFor(async () =>
      expect((await listOf(host))[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.ready),
    )
    const [view] = await listOf(host)
    const downloadId = view?.downloadId ?? ''
    expect(await host.request({ type: DESKTOP_REQUESTS.openDownload, downloadId })).toEqual({
      type: DESKTOP_REPLIES.navigate,
      to: browserPlayPathOf(downloadId),
    })
    expect(
      await host.request({
        type: DESKTOP_REQUESTS.openDownload,
        downloadId: '0c000000-0000-4000-8000-000000000009',
      }),
    ).toEqual({ type: DESKTOP_REPLIES.refused, message: BROWSER_DOWNLOAD_COPY.unknown })
  })

  it('pauses, resumes, retries and deletes, answering each with the list', async () => {
    const stuck = stuckAnswer(bytesOfLength(2))
    const server = fakeServer({ media: [MOVIE], files: { 7: bytesOfLength(10) } })
    server.answers.push(stuck.answer)
    const { host } = await hosted(server)
    await download(host)
    await waitFor(async () =>
      expect((await listOf(host))[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.downloading),
    )
    const downloadId = (await listOf(host))[0]?.downloadId ?? ''
    const kindAfter = async (type: StatusRequest) => {
      const reply = await host.request({ type, downloadId })
      return reply.type === DESKTOP_REPLIES.downloads
        ? (reply.downloads[0]?.status.kind ?? null)
        : null
    }
    expect(await kindAfter(DESKTOP_REQUESTS.pauseDownload)).toBe(DOWNLOAD_STATUS_KINDS.paused)
    expect(await kindAfter(DESKTOP_REQUESTS.resumeDownload)).toBe(DOWNLOAD_STATUS_KINDS.queued)
    expect(await kindAfter(DESKTOP_REQUESTS.pauseDownload)).toBe(DOWNLOAD_STATUS_KINDS.paused)
    expect(await kindAfter(DESKTOP_REQUESTS.retryDownload)).toBe(DOWNLOAD_STATUS_KINDS.queued)
    expect(await host.request({ type: DESKTOP_REQUESTS.pauseAllDownloads })).toMatchObject({
      downloads: [{ status: { kind: DOWNLOAD_STATUS_KINDS.paused } }],
    })
    expect(await host.request({ type: DESKTOP_REQUESTS.resumeAllDownloads })).toMatchObject({
      downloads: [{ status: { kind: DOWNLOAD_STATUS_KINDS.queued } }],
    })
    expect(await host.request({ type: DESKTOP_REQUESTS.deleteDownload, downloadId })).toMatchObject(
      { type: DESKTOP_REPLIES.downloads, downloads: [] },
    )
    await download(host)
    expect(await host.request({ type: DESKTOP_REQUESTS.deleteAllDownloads })).toMatchObject({
      type: DESKTOP_REPLIES.downloads,
      downloads: [],
    })
  })

  it('reads the space as the protocol names it', async () => {
    const { host } = await hosted()
    expect(await host.request({ type: DESKTOP_REQUESTS.readSpace })).toEqual({
      type: DESKTOP_REPLIES.space,
      space: { free: 1_000_000, total: 1_000_000, used: 0 },
    })
  })

  it('refuses what a browser does not do with its downloads', async () => {
    const { host } = await hosted()
    const refusal = { type: DESKTOP_REPLIES.refused, message: BROWSER_DOWNLOAD_COPY.unsupported }
    expect(await host.request({ type: DESKTOP_REQUESTS.showDownloadsFolder })).toEqual(refusal)
    expect(
      await host.request({ type: DESKTOP_REQUESTS.setDownloadDefaults, shouldAutoDelete: true }),
    ).toEqual(refusal)
  })

  it('answers with a refusal when the disk fails under a request', async () => {
    const { host, disk } = await hosted()
    disk.disk.space = async () => {
      throw new Error('The disk went away.')
    }
    expect(await host.request({ type: DESKTOP_REQUESTS.readSpace })).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: BROWSER_DOWNLOAD_COPY.unreachable,
    })
  })

  it('reads a saved picture through the engine', async () => {
    const { host } = await hosted()
    expect(host.pictureUrl('0c000000-0000-4000-8000-000000000001')).toBeNull()
  })
})
