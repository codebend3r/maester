import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import {
  DESKTOP_PATHS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_KINDS,
  DOWNLOAD_STATUS_KINDS,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { useAudioQueue } from '@raven/ui/headless'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { DownloadsPage } from '@/desktop/DownloadsPage/DownloadsPage'
import { api } from '@/lib/api'
import { Where, where } from '@/test/authPage'
import {
  asDesktop,
  DL_1,
  DL_2,
  DL_3,
  downloadsMain,
  type FakeClient,
  FILE_ID,
  GB,
  sentOfType,
  viewOf,
} from '@/test/desktop'
import { track } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { playPathOf } from '@/desktop/paths'

const EPISODE_2 = viewOf({
  downloadId: DL_2,
  label: 'S01E02 Half Loop',
  group: { kind: DOWNLOAD_KINDS.season, key: 'show:4', title: 'Severance', order: 10_002 },
  status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: GB },
})

const DUNE = viewOf({
  downloadId: DL_3,
  label: 'Dune (2021)',
  group: { kind: DOWNLOAD_KINDS.movie, key: 'movie:41', title: 'Dune (2021)', order: 0 },
  status: { kind: DOWNLOAD_STATUS_KINDS.ready },
  watched: 0.5,
})

const OK_COMPUTER = {
  kind: DOWNLOAD_KINDS.album,
  key: 'album:7',
  sourceId: 7,
  title: 'OK Computer',
  cover: { albumId: 7, coverVersion: 'cover-v1' },
} as const

const ALBUM_TRACKS = [
  track({ id: 101, title: 'Airbag', number: 1 }),
  track({ id: 102, title: 'Paranoid Android', number: 2 }),
  track({ id: 103, title: 'Subterranean Homesick Alien', number: 3 }),
]

/** An album's tracks downloaded and ready, each keeping its `Track`. */
const albumRows = ALBUM_TRACKS.map((each, order) =>
  viewOf({
    downloadId: `0b000000-0000-4000-8000-00000000000${order + 1}`,
    label: each.title,
    group: { ...OK_COMPUTER, order },
    status: { kind: DOWNLOAD_STATUS_KINDS.ready },
    track: each,
  }),
)

const renderPage = (client: FakeClient) => {
  asDesktop(client)
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
}

const rowOf = (label: string) => {
  const name = screen.getByText(label)
  const row = name.closest('li')
  if (row === null) throw new Error(`No row for ${label}`)
  return row
}

describe('DownloadsPage', () => {
  afterEach(() => {
    useAudioQueue.getState().clear()
  })

  it('says there is nothing yet', async () => {
    renderPage(downloadsMain())
    expect(await screen.findByText(/Nothing downloaded yet/)).toBeInTheDocument()
  })

  it("groups a show's episodes under it in play order, a movie on its own, and the disk", async () => {
    renderPage(downloadsMain({ downloads: [EPISODE_2, DUNE, viewOf()] }))
    const show = await screen.findByRole('region', { name: 'Severance' })
    const labels = within(show)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('span')?.textContent)
    expect(labels).toEqual(['S01E01 Good News', 'S01E02 Half Loop'])
    expect(screen.getByText('Dune (2021)')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dune (2021)' })).toBeNull()
    expect(
      await screen.findByText('34.2 GB of downloads · 412.0 GB free of 1.0 TB'),
    ).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Disk' })).toBeInTheDocument()
    expect(within(rowOf('S01E02 Half Loop')).getByText('1.0 GB of 2.0 GB')).toBeInTheDocument()
    expect(within(rowOf('S01E01 Good News')).getByText('Waiting')).toBeInTheDocument()
    expect(
      within(rowOf('Dune (2021)')).getByRole('progressbar', { name: '50% watched' }),
    ).toBeInTheDocument()
  })

  it('heads an album with its cover, its title and how many of its tracks are here', async () => {
    const tracks = Array.from({ length: 12 }, (_, index) =>
      viewOf({
        downloadId: `0a000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
        label: `Track ${index + 1}`,
        group: {
          kind: DOWNLOAD_KINDS.album,
          key: 'album:7',
          sourceId: 7,
          title: 'OK Computer',
          order: index,
          cover: { albumId: 7, coverVersion: 'cover-v1' },
        },
        status: { kind: DOWNLOAD_STATUS_KINDS.ready },
      }),
    )
    renderPage(downloadsMain({ downloads: tracks.toReversed() }))
    const album = await screen.findByRole('region', { name: 'OK Computer' })
    expect(within(album).getByRole('heading', { name: 'OK Computer' })).toBeInTheDocument()
    expect(within(album).getByText('12 tracks')).toBeInTheDocument()
    expect(album.querySelector('img')?.getAttribute('src')).toBe(
      api.albumCoverUrl({ albumId: 7, coverVersion: 'cover-v1' }),
    )
    expect(
      within(album)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('span')?.textContent),
    ).toEqual(tracks.map(({ label }) => label))
  })

  it("heads a playlist of one track with its first track's album cover", async () => {
    renderPage(
      downloadsMain({
        downloads: [
          viewOf({
            label: 'Late night',
            group: {
              kind: DOWNLOAD_KINDS.playlist,
              key: 'playlist:5',
              sourceId: 5,
              title: 'Late night',
              order: 0,
              cover: { albumId: 9, coverVersion: 'm1' },
            },
          }),
        ],
      }),
    )
    const playlist = await screen.findByRole('region', { name: 'Late night' })
    expect(within(playlist).getByText('1 track')).toBeInTheDocument()
    expect(playlist.querySelector('img')?.getAttribute('src')).toBe(
      api.albumCoverUrl({ albumId: 9, coverVersion: 'm1' }),
    )
  })

  it('shows a ready track neither watched nor set to delete once watched, as a video is', async () => {
    renderPage(
      downloadsMain({
        downloads: [
          DUNE,
          viewOf({
            downloadId: DL_1,
            label: 'Airbag',
            track: track({ id: 101, title: 'Airbag' }),
            group: {
              kind: DOWNLOAD_KINDS.album,
              key: 'album:7',
              sourceId: 7,
              title: 'OK Computer',
              order: 1,
              cover: { albumId: 7, coverVersion: 'cover-v1' },
            },
            status: { kind: DOWNLOAD_STATUS_KINDS.ready },
            watched: 0.5,
          }),
        ],
      }),
    )
    await screen.findByRole('region', { name: 'OK Computer' })
    const airbag = rowOf('Airbag')
    expect(within(airbag).queryByRole('progressbar')).toBeNull()
    expect(within(airbag).queryByRole('switch')).toBeNull()
    expect(within(airbag).getByRole('button', { name: 'Play Airbag' })).toBeInTheDocument()
    const movie = rowOf('Dune (2021)')
    expect(within(movie).getByRole('progressbar', { name: '50% watched' })).toBeInTheDocument()
    expect(within(movie).getByRole('switch')).toBeInTheDocument()
  })

  it('pauses, resumes and retries a download, and sets it to delete once watched', async () => {
    const client = downloadsMain({
      downloads: [
        viewOf(),
        viewOf({
          downloadId: DL_2,
          label: 'Broken',
          status: {
            kind: DOWNLOAD_STATUS_KINDS.failed,
            bytes: 0,
            message: 'The server went away.',
          },
        }),
      ],
    })
    renderPage(client)
    await userEvent.click(await screen.findByRole('button', { name: 'Pause S01E01 Good News' }))
    expect(await screen.findByText('Paused')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resume S01E01 Good News' }))
    expect(await screen.findByText('Waiting')).toBeInTheDocument()
    expect(screen.getByText('Failed: The server went away.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry Broken' }))
    await userEvent.click(within(rowOf('S01E01 Good News')).getByRole('switch'))
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.setDownloadAutoDelete })).toEqual([
        { type: DESKTOP_REQUESTS.setDownloadAutoDelete, downloadId: DL_1, shouldAutoDelete: true },
      ]),
    )
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.retryDownload })).toHaveLength(1)
  })

  it('pauses and resumes everything at once, and shows the folder', async () => {
    const client = downloadsMain({
      downloads: [
        viewOf(),
        viewOf({
          downloadId: DL_2,
          label: 'Held',
          status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 0, message: null },
        }),
      ],
    })
    renderPage(client)
    await userEvent.click(await screen.findByRole('button', { name: 'Pause all' }))
    await userEvent.click(screen.getByRole('button', { name: 'Resume all' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
    expect(client.request.mock.calls.map(([request]) => request.type)).toEqual(
      expect.arrayContaining([
        DESKTOP_REQUESTS.pauseAllDownloads,
        DESKTOP_REQUESTS.resumeAllDownloads,
        DESKTOP_REQUESTS.showDownloadsFolder,
      ]),
    )
  })

  it('plays a ready download in Raven', async () => {
    const client = downloadsMain({
      downloads: [DUNE],
      answers: {
        openDownload: { type: DESKTOP_REPLIES.play, target: { fileId: FILE_ID, queue: [] } },
      },
    })
    renderPage(client)
    await userEvent.click(await screen.findByRole('button', { name: 'Play Dune (2021)' }))
    await waitFor(() => expect(where()).toBe(playPathOf(FILE_ID)))
  })

  it("plays a downloaded track with its album's downloaded tracks from it, in no player", async () => {
    const client = downloadsMain({ downloads: albumRows.toReversed() })
    renderPage(client)
    await userEvent.click(await screen.findByRole('button', { name: 'Play Paranoid Android' }))
    const { queue } = useAudioQueue.getState()
    expect(queue.items).toEqual([101, 102, 103])
    expect(queue.at).toBe(1)
    expect(queue.source).toEqual({ kind: 'album', id: 7 })
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.openDownload })).toEqual([])
  })

  it("plays an album's downloaded tracks from the top from its head", async () => {
    renderPage(downloadsMain({ downloads: albumRows }))
    await userEvent.click(await screen.findByRole('button', { name: 'Play OK Computer' }))
    const { queue } = useAudioQueue.getState()
    expect(queue.items).toEqual([101, 102, 103])
    expect(queue.at).toBe(0)
  })

  it('plays a playlist as itself, and leaves out a track still downloading', async () => {
    const group = {
      kind: DOWNLOAD_KINDS.playlist,
      key: 'playlist:5',
      sourceId: 5,
      title: 'Late night',
      cover: { albumId: 9, coverVersion: 'm1' },
    } as const
    const [first, second, third] = albumRows
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('expected three rows')
    }
    renderPage(
      downloadsMain({
        downloads: [
          { ...third, group: { ...group, order: 0 } },
          {
            ...first,
            group: { ...group, order: 1 },
            status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: GB },
          },
          { ...second, group: { ...group, order: 2 } },
        ],
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Play Paranoid Android' }))
    const { queue } = useAudioQueue.getState()
    expect(queue.items).toEqual([103, 102])
    expect(queue.at).toBe(1)
    expect(queue.source).toEqual({ kind: 'playlist', id: 5 })
  })

  it('shows no Play on a track downloaded before its track was kept', async () => {
    const [, second] = albumRows
    if (second === undefined) throw new Error('expected a row')
    renderPage(downloadsMain({ downloads: [{ ...second, track: null }] }))
    await screen.findByRole('region', { name: 'OK Computer' })
    expect(screen.queryByRole('button', { name: 'Play Paranoid Android' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Play OK Computer' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete Paranoid Android' })).toBeInTheDocument()
  })

  it('shows no Play on an album kept before its id was', async () => {
    renderPage(
      downloadsMain({
        downloads: albumRows.map((row) => ({
          ...row,
          group: { ...OK_COMPUTER, order: row.group.order, sourceId: undefined },
        })),
      }),
    )
    await screen.findByRole('region', { name: 'OK Computer' })
    expect(screen.queryByRole('button', { name: 'Play OK Computer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Play Airbag' })).toBeNull()
  })

  it('asks before deleting, frees the room it says, and can be talked out of it', async () => {
    const client = downloadsMain({ downloads: [DUNE] })
    renderPage(client)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Dune (2021)' }))
    expect(screen.getByText('Delete Dune (2021)? 2.0 GB will be freed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Delete Dune (2021)' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Dune (2021)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/Nothing downloaded yet/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Downloads' })).toHaveFocus()
  })

  it("says main's refusal and keeps the row", async () => {
    const client = downloadsMain({
      downloads: [DUNE],
      answers: { deleteDownload: { type: DESKTOP_REPLIES.refused, message: 'It is playing.' } },
    })
    renderPage(client)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Dune (2021)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('It is playing.')).toBeInTheDocument()
    expect(screen.getByText('Dune (2021)')).toBeInTheDocument()
  })

  it('asks for the PIN before resuming a download from a library locked again', async () => {
    const unlock = spyOn(api, 'unlock').mockResolvedValue({ available: true, unlocked: true })
    const client = downloadsMain({
      downloads: [
        viewOf({
          status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 0, message: 'Locked' },
          isLocked: true,
        }),
      ],
    })
    renderPage(client)
    await userEvent.click(await screen.findByRole('button', { name: 'Resume S01E01 Good News' }))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.resumeDownload })).toEqual([])
    await userEvent.type(await screen.findByLabelText('PIN'), '3001')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.resumeDownload })).toHaveLength(1),
    )
    expect(unlock).toHaveBeenCalledWith('3001')
    unlock.mockRestore()
  })

  it('says why main could not list its downloads or read the disk', async () => {
    const client = downloadsMain({
      answers: {
        listDownloads: { type: DESKTOP_REPLIES.refused, message: 'The list is unreadable.' },
        readSpace: { type: DESKTOP_REPLIES.done },
      },
    })
    renderPage(client)
    expect(await screen.findByRole('alert')).toHaveTextContent('The list is unreadable.')
    expect(await screen.findByText('Raven could not read its disk space.')).toBeInTheDocument()
  })

  it('counts down to a delete once watched', async () => {
    const now = Date.now()
    renderPage(downloadsMain({ downloads: [{ ...DUNE, deletesAt: now + 90_000 }] }))
    expect(await screen.findByText('Deletes in 2 minutes')).toBeInTheDocument()
  })
})
