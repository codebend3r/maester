import {
  DESKTOP_PATHS,
  DOWNLOAD_TARGET_KINDS,
  PAGE_PATHS,
  CONTAINERS,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_STATUS_KINDS,
  watchPageOf,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { usePlayerPrefs } from '@raven/ui/headless'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { LOCAL_ACCOUNT } from '@/browserDownloads/entries'
import { BROWSER_PLAY_PATH, browserPlayPathOf } from '@/browserDownloads/paths'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { DownloadsPage } from '@/desktop/DownloadsPage/DownloadsPage'
import { DOWNLOADS_PAGE_COPY } from '@/desktop/DownloadsPage/copy'
import { api } from '@/lib/api'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { HostSettings } from '@/pages/SettingsPage/HostSettings'
import { WatchPage } from '@/pages/WatchPage/WatchPage'
import { useDownloadAsk } from '@/stores/downloadAsk'
import { useDownloadPreparing } from '@/stores/downloadPreparing'
import { useServerReach } from '@/stores/serverReach'
import { Where, where } from '@/test/authPage'
import {
  asBrowserDownloads,
  bytesOfLength,
  fakeEngine,
  fakeServer,
  stuckAnswer,
  withReadyDownload,
} from '@/test/browserDownloads'
import { itemDetails, itemSummary, library, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const MOVIE = mediaItem({ id: 7, container: CONTAINERS.mp4, size: 10, duration: 600, item: null })

/** What stands in for the download's player, so a test sees the page went to it. */
const PLAYING = 'Download playing'

const serverOf = (props: Parameters<typeof fakeServer>[0] = {}) =>
  fakeServer({ media: [MOVIE], files: { 7: bytesOfLength(10) }, ...props })

describe('a watch page with no server, in a browser that keeps downloads', () => {
  const renderWatch = (route: string) =>
    renderWithProviders({
      route,
      ui: (
        <Routes>
          <Route path={`${PAGE_PATHS.watch}/:id`} element={<WatchPage />} />
          <Route path={BROWSER_PLAY_PATH} element={<p>{PLAYING}</p>} />
          <Route path="*" element={<Where />} />
        </Routes>
      ),
    })

  it("plays the title's download instead of failing", async () => {
    const { downloadId } = await withReadyDownload({ mediaId: 7, server: serverOf() })
    useServerReach.setState({ isOffline: true })
    const { container } = renderWatch(watchPageOf(7))
    expect(await screen.findByText(PLAYING)).toBeInTheDocument()
    expect(container).not.toHaveTextContent('Loading')
    expect(downloadId).not.toBe('')
  })

  it('goes to Downloads for a title that is not downloaded, to come back once the server answers', async () => {
    await withReadyDownload({ mediaId: 7, server: serverOf() })
    useServerReach.setState({ isOffline: true })
    renderWatch(`${watchPageOf(8)}?at=5`)
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
  })

  it("leaves a private library's download shut, and goes to Downloads", async () => {
    spyOn(api, 'getLock').mockRejectedValue(new TypeError('Failed to fetch'))
    const locked = library({ settings: { ...library().settings, locked: true } })
    await withReadyDownload({ mediaId: 7, server: serverOf({ libraries: [locked] }) })
    useServerReach.setState({ isOffline: true })
    renderWatch(watchPageOf(7))
    await waitFor(() => expect(where()).toBe(DESKTOP_PATHS.downloads))
  })

  it('waits while the downloads are still being read from disk', async () => {
    const { engine } = await fakeEngine({ server: serverOf(), account: null })
    asBrowserDownloads(engine)
    const unread = { ...engine, isSettled: () => false }
    asBrowserDownloads(unread)
    useServerReach.setState({ isOffline: true })
    renderWatch(watchPageOf(7))
    expect(await screen.findByText('Loading')).toBeInTheDocument()
  })

  it('plays from the server as ever while it answers', async () => {
    const getMedia = spyOn(api, 'getMedia').mockImplementation(() => new Promise(() => undefined))
    await withReadyDownload({ mediaId: 7, server: serverOf() })
    renderWatch(watchPageOf(7))
    expect(await screen.findByText('Loading')).toBeInTheDocument()
    expect(screen.queryByText(PLAYING)).toBeNull()
    getMedia.mockRestore()
  })
})

describe('AppRoutes in a browser that keeps downloads', () => {
  const list = spyOn(api, 'listLibraries')

  afterEach(() => list.mockReset())

  it('opens Downloads, with no On this Mac and no music Downloads', async () => {
    list.mockImplementation(async () => [])
    const { engine } = await fakeEngine({ server: serverOf() })
    asBrowserDownloads(engine)
    const { unmount } = renderWithProviders({ ui: <AppRoutes />, route: DESKTOP_PATHS.downloads })
    expect(await screen.findByRole('heading', { level: 1, name: 'Downloads' })).toBeInTheDocument()
    expect(await screen.findByText(DOWNLOADS_PAGE_COPY.empty.browser)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show in Finder' })).toBeNull()
    unmount()
    renderWithProviders({ ui: <AppRoutes />, route: DESKTOP_PATHS.local })
    expect(
      await screen.findByRole('heading', { name: 'Nothing lives at this address' }),
    ).toBeInTheDocument()
  })

  it("opens a download's own player, outside the browsing frame", async () => {
    list.mockImplementation(async () => [])
    // Accounts are off here, so the downloads are the one shared account's.
    const { downloadId } = await withReadyDownload({
      mediaId: 7,
      server: serverOf(),
      account: LOCAL_ACCOUNT,
    })
    renderWithProviders({ ui: <AppRoutes />, route: browserPlayPathOf(downloadId) })
    await waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src') ?? '').toStartWith('blob:'),
    )
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('has no player of a download where the browser keeps none', async () => {
    list.mockImplementation(async () => [])
    renderWithProviders({ ui: <AppRoutes />, route: browserPlayPathOf('x') })
    expect(
      await screen.findByRole('heading', { name: 'Nothing lives at this address' }),
    ).toBeInTheDocument()
  })
})

describe('the Downloads page in a browser', () => {
  const renderPage = () =>
    renderWithProviders({
      route: DESKTOP_PATHS.downloads,
      ui: (
        <>
          <Routes>
            <Route path={DESKTOP_PATHS.downloads} element={<DownloadsPage />} />
            <Route path="*" element={<Where />} />
          </Routes>
          <Toaster />
        </>
      ),
    })

  it('shows a saved poster by its object URL, with no folder button and no delete-once-watched switch', async () => {
    const movie = { ...MOVIE, item: itemSummary({ id: 40 }) }
    const server = serverOf({
      media: [movie],
      items: [itemDetails({ id: 40, posterVersion: 'p1', logoVersion: null })],
      pictures: { '40:poster': new Blob(['poster'], { type: 'image/jpeg' }) },
    })
    await withReadyDownload({ mediaId: 7, server })
    renderPage()
    const row = (await screen.findByText('Busboys (2026)')).closest('li')
    if (row === null) throw new Error('The download has no row.')
    await waitFor(() =>
      expect(row.querySelector('img')?.getAttribute('src') ?? '').toStartWith('blob:fake/'),
    )
    expect(screen.queryByRole('button', { name: 'Show in Finder' })).toBeNull()
    expect(within(row).queryByRole('switch')).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: /^Play/ }))
    await waitFor(() => expect(where()).toStartWith(`${DESKTOP_PATHS.downloads}/play/`))
  })

  it('says how far along the server is with a copy a download waits on', async () => {
    const stuck = stuckAnswer(bytesOfLength(2))
    const server = serverOf()
    server.answers.push(stuck.answer)
    const { engine } = await fakeEngine({ server })
    asBrowserDownloads(engine)
    const first = await engine.ask({ kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 })
    if (!first.ok) throw new Error(first.message)
    engine.confirm(first.value.askId)
    await waitFor(() =>
      expect(engine.list()[0]?.status.kind ?? null).toBe(DOWNLOAD_STATUS_KINDS.downloading),
    )
    engine.pause(engine.list()[0]?.downloadId ?? '')
    engine.resume(engine.list()[0]?.downloadId ?? '')
    const downloadId = engine.list()[0]?.downloadId ?? ''
    renderPage()
    expect(await screen.findByText('Waiting')).toBeInTheDocument()
    act(() => useDownloadPreparing.setState({ progress: { [downloadId]: 0.426 } }))
    expect(screen.getByText('Preparing 42%')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Watch/ }))
    expect(screen.getByText('Preparing 42%')).toBeInTheDocument()
  })
})

describe('the Download button in a browser that keeps downloads', () => {
  const open = spyOn(ravenPlayer, 'open').mockImplementation(() => {})

  afterEach(() => open.mockClear())

  it('asks the browser itself for a video, whatever Raven is set to open', async () => {
    const { engine } = await fakeEngine({ server: serverOf() })
    asBrowserDownloads(engine)
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    renderWithProviders({
      ui: <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.media, mediaId: 7 }} />,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() =>
      expect(useDownloadAsk.getState().shown?.ask.status ?? null).toMatchObject({
        kind: DOWNLOAD_ASK_KINDS.ready,
        files: 1,
      }),
    )
    expect(open).not.toHaveBeenCalled()
  })

  it('leaves an album to Raven, as before: its link where Raven is installed, nothing elsewhere', async () => {
    const { engine } = await fakeEngine({ server: serverOf() })
    asBrowserDownloads(engine)
    const album = { kind: DOWNLOAD_TARGET_KINDS.album, albumId: 3 } as const
    const { unmount, container } = renderWithProviders({ ui: <DownloadButton target={album} /> })
    expect(container.querySelector('button')).toBeNull()
    unmount()
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    renderWithProviders({ ui: <DownloadButton target={album} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Download to Raven' }))
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('Settings in a browser', () => {
  it('has a Downloads section where the browser keeps downloads: its room and Delete all', async () => {
    const { engine } = await withReadyDownload({ mediaId: 7, server: serverOf() })
    renderWithProviders({ ui: <HostSettings /> })
    const section = await screen.findByRole('region', { name: 'Downloads' })
    expect(section).toHaveTextContent('What raven keeps in this browser')
    expect(await within(section).findByText(/free in this browser\./)).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Show in Finder' })).toBeNull()
    expect(within(section).queryByRole('checkbox')).toBeNull()
    const ask = within(section).getByRole('button', { name: 'Delete all downloads' })
    await waitFor(() => expect(ask).toBeEnabled())
    await userEvent.click(ask)
    await userEvent.click(within(section).getByRole('button', { name: 'Delete all' }))
    await waitFor(() => expect(engine.list()).toEqual([]))
  })

  it('has nothing of its own where the browser keeps none', () => {
    const { container } = renderWithProviders({ ui: <HostSettings /> })
    expect(container).toBeEmptyDOMElement()
  })
})
