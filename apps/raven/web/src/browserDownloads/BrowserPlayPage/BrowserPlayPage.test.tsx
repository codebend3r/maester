import {
  DESKTOP_PATHS,
  DOWNLOAD_TARGET_KINDS,
  CONTAINERS,
  DOWNLOAD_STATUS_KINDS,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { BrowserPlayRoute } from '@/browserDownloads/BrowserPlayPage/BrowserPlayPage'
import { BROWSER_PLAY_COPY } from '@/browserDownloads/BrowserPlayPage/copy'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import { BROWSER_PLAY_PATH, browserPlayPathOf } from '@/browserDownloads/paths'
import { DOWNLOADS_PAGE_COPY } from '@/desktop/DownloadsPage/copy'
import { api } from '@/lib/api'
import { useServerReach } from '@/stores/serverReach'
import { Where, where } from '@/test/authPage'
import {
  asBrowserDownloads,
  bytesOfLength,
  fakeEngine,
  fakeServer,
  statusAnswer,
  withReadyDownload,
} from '@/test/browserDownloads'
import { sourcedVideo } from '@/test/desktopPlayer'
import { itemDetails, itemSummary, library, mediaItem } from '@/test/fixtures'
import '@/test/mediaError'
import { renderWithProviders } from '@/test/render'

const MOVIE = mediaItem({ id: 7, container: CONTAINERS.mp4, size: 10, duration: 600, item: null })

const serverOf = (props: Parameters<typeof fakeServer>[0] = {}) =>
  fakeServer({ media: [MOVIE], files: { 7: bytesOfLength(10) }, ...props })

type RenderPlayProps = { downloadId: string; isStrict?: boolean }

const renderPlay = ({ downloadId, isStrict = false }: RenderPlayProps) => {
  const pages = (
    <>
      <Routes>
        <Route path={BROWSER_PLAY_PATH} element={<BrowserPlayRoute />} />
        <Route path="*" element={<Where />} />
      </Routes>
      <Toaster />
    </>
  )
  return renderWithProviders({
    route: browserPlayPathOf(downloadId),
    behind: [DESKTOP_PATHS.downloads],
    ui: isStrict ? <StrictMode>{pages}</StrictMode> : pages,
  })
}

describe('BrowserPlayPage', () => {
  const recordPlay = spyOn(api, 'recordPlay').mockResolvedValue(undefined)
  const saveProgress = spyOn(api, 'saveProgress').mockResolvedValue(undefined)

  afterEach(() => {
    recordPlay.mockClear()
    saveProgress.mockClear()
  })

  it("plays a ready download from an object URL of its file, under the download's name", async () => {
    const { downloadId, urls } = await withReadyDownload({ mediaId: 7, server: serverOf() })
    const { unmount } = renderPlay({ downloadId })
    const video = await waitFor(() => {
      const element = document.querySelector('video')
      if (element === null) throw new Error('no video element')
      return element
    })
    await waitFor(() => expect(video.getAttribute('src')).toStartWith('blob:fake/'))
    expect(await screen.findByRole('heading', { name: MOVIE.title })).toBeInTheDocument()
    expect(urls.live.size).toBe(1)
    unmount()
    // Leaving lets go of the file's URL, so the browser frees it.
    expect(urls.live.size).toBe(0)
  })

  it('opens the file once and lets go of each URL under StrictMode', async () => {
    const { downloadId, urls } = await withReadyDownload({ mediaId: 7, server: serverOf() })
    const { unmount } = renderPlay({ downloadId, isStrict: true })
    await waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src') ?? '').toStartWith('blob:'),
    )
    expect(urls.live.size).toBe(1)
    unmount()
    expect(urls.live.size).toBe(0)
  })

  it('heads the player with the saved title art, and starts where the viewer left it', async () => {
    const movie = { ...MOVIE, item: itemSummary({ id: 40 }) }
    const server = serverOf({
      media: [movie],
      items: [itemDetails({ id: 40, posterVersion: null, logoVersion: 'l1' })],
      pictures: { '40:logo': new Blob(['logo'], { type: 'image/png' }) },
    })
    const { downloadId, engine } = await withReadyDownload({ mediaId: 7, server })
    engine.savePosition({ downloadId, position: 120, duration: 600 })
    renderPlay({ downloadId })
    const logo = await screen.findByRole('img', { name: 'Busboys (2026)' })
    expect(logo.getAttribute('src')).toStartWith('blob:fake/')
    const video = await sourcedVideo(document.querySelector('video')?.getAttribute('src') ?? '')
    fireEvent(video, new Event('loadedmetadata'))
    await waitFor(() => expect(video.currentTime).toBe(120))
  })

  it('keeps the position with the download, and reports the play and the position to the server', async () => {
    const { downloadId, engine } = await withReadyDownload({ mediaId: 7, server: serverOf() })
    renderPlay({ downloadId })
    const video = await waitFor(() => {
      const element = document.querySelector('video')
      if (element === null || element.getAttribute('src') === null)
        throw new Error('no video source')
      return element
    })
    fireEvent(video, new Event('loadedmetadata'))
    fireEvent(video, new Event('playing'))
    await waitFor(() => expect(recordPlay).toHaveBeenCalledWith(7))
    video.currentTime = 42
    fireEvent(video, new Event('timeupdate'))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
    const playable = engine.playable(downloadId)
    expect(playable).toMatchObject({ ok: true, value: { resumeAt: 42 } })
  })

  it('reports nothing to a server out of reach, and still keeps the position', async () => {
    const { downloadId, engine } = await withReadyDownload({ mediaId: 7, server: serverOf() })
    useServerReach.setState({ isOffline: true })
    renderPlay({ downloadId })
    const video = await waitFor(() => {
      const element = document.querySelector('video')
      if (element === null || element.getAttribute('src') === null)
        throw new Error('no video source')
      return element
    })
    fireEvent(video, new Event('loadedmetadata'))
    fireEvent(video, new Event('playing'))
    video.currentTime = 30
    fireEvent(video, new Event('timeupdate'))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
    expect(recordPlay).not.toHaveBeenCalled()
    expect(saveProgress).not.toHaveBeenCalled()
    expect(engine.playable(downloadId)).toMatchObject({ ok: true, value: { resumeAt: 30 } })
  })

  it('says a download that is not ready will not play yet', async () => {
    const server = serverOf()
    server.answers.push(statusAnswer(500))
    const { engine } = await fakeEngine({ server })
    asBrowserDownloads(engine)
    const asked = await engine.ask({ kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 })
    if (!asked.ok) throw new Error(asked.message)
    engine.confirm(asked.value.askId)
    await waitFor(() =>
      expect(engine.list()[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.failed),
    )
    renderPlay({ downloadId: engine.list()[0]?.downloadId ?? '' })
    expect(await screen.findByRole('alert')).toHaveTextContent(BROWSER_DOWNLOAD_COPY.notReady)
  })

  it("keeps a private library's download shut until the PIN is entered", async () => {
    spyOn(api, 'getLock').mockResolvedValue({ unlocked: false, available: true })
    const locked = library({ settings: { ...library().settings, locked: true } })
    const server = serverOf({ libraries: [locked] })
    const { downloadId } = await withReadyDownload({ mediaId: 7, server })
    renderPlay({ downloadId })
    expect(await screen.findByRole('alert')).toHaveTextContent(DOWNLOADS_PAGE_COPY.hidden)
    expect(document.querySelector('video')).toBeNull()
  })

  it('says the file is gone when the disk no longer holds it', async () => {
    const { downloadId, disk } = await withReadyDownload({ mediaId: 7, server: serverOf() })
    disk.files.forEach((_, name) => {
      if (name.endsWith('media.mp4')) disk.files.delete(name)
    })
    renderPlay({ downloadId })
    expect(await screen.findByRole('alert')).toHaveTextContent(BROWSER_DOWNLOAD_COPY.fileGone)
  })

  it('waits for a download while the list is still being read, and leads back to Downloads', async () => {
    const { engine } = await fakeEngine({ server: serverOf() })
    spyOn(engine, 'isSettled').mockReturnValue(false)
    asBrowserDownloads(engine)
    renderPlay({ downloadId: 'aaaaaaaa-0000-4000-8000-000000000099' })
    expect(await screen.findByText('Loading')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
  })

  it('refuses a download this browser does not hold, and leads back to Downloads', async () => {
    const { engine } = await fakeEngine({ server: serverOf() })
    asBrowserDownloads(engine)
    renderPlay({ downloadId: 'aaaaaaaa-0000-4000-8000-000000000099' })
    expect(await screen.findByRole('alert')).toHaveTextContent(BROWSER_DOWNLOAD_COPY.unknown)
    expect(screen.queryByText('Loading')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
  })

  it('will not open an address that names no download', async () => {
    const { engine } = await fakeEngine({ server: serverOf() })
    asBrowserDownloads(engine)
    renderPlay({ downloadId: 'not-an-id' })
    expect(await screen.findByRole('alert')).toHaveTextContent(BROWSER_PLAY_COPY.notOpenable)
  })
})
