import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  DESKTOP_PATHS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_KINDS,
  DOWNLOAD_STATUS_KINDS,
  QUEUE_SOURCE_KINDS,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { useAudioQueue } from '@raven/ui/headless'
import { act, screen, waitFor, within } from '@testing-library/react'
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
import { useDownloadSpeeds } from '@/stores/downloadSpeeds'
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

beforeEach(() => useDownloadSpeeds.setState({ samples: {} }))

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
      .map((row) => row.querySelector('span[id]')?.textContent)
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
        .map((row) => row.querySelector('span[id]')?.textContent),
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
    expect(queue.source).toEqual({ kind: QUEUE_SOURCE_KINDS.album, id: 7 })
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
    expect(queue.source).toEqual({ kind: QUEUE_SOURCE_KINDS.playlist, id: 5 })
  })

  it('shows no Play on a track of a server Raven no longer holds', async () => {
    const [, second] = albumRows
    if (second === undefined) throw new Error('expected a row')
    renderPage(downloadsMain({ downloads: [{ ...second, track: null }] }))
    await screen.findByRole('region', { name: 'OK Computer' })
    expect(screen.queryByRole('button', { name: 'Play Paranoid Android' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Play OK Computer' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete Paranoid Android' })).toBeInTheDocument()
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

describe('DownloadsPage progress', () => {
  it('names what is downloading, with a looping light on its bar, and starts with no speed', async () => {
    renderPage(downloadsMain({ downloads: [EPISODE_2] }))
    expect(await screen.findByText('Downloading 1 file')).toBeInTheDocument()
    expect(within(rowOf('S01E02 Half Loop')).getByText('Starting')).toBeInTheDocument()
    expect(document.querySelectorAll('progress + span[aria-hidden="true"]')).toHaveLength(2)
  })

  it('shows how fast a download is going, on its row and for all of them', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(1_000_000)
    renderPage(downloadsMain({ downloads: [EPISODE_2] }))
    await screen.findByText('Starting')
    clock.mockReturnValue(1_001_000)
    act(() =>
      useDownloadSpeeds.getState().observe({
        downloads: [
          { ...EPISODE_2, status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: GB + 5e6 } },
        ],
        now: Date.now(),
      }),
    )
    expect(await screen.findByText('Downloading 1 file at 5.0 MB/s')).toBeInTheDocument()
    expect(within(rowOf('S01E02 Half Loop')).getByText('5.0 MB/s')).toBeInTheDocument()
    clock.mockRestore()
  })

  it('shows no activity when nothing is on its way', async () => {
    renderPage(downloadsMain({ downloads: [DUNE] }))
    await screen.findByText('Dune (2021)')
    expect(screen.queryByText(/^Downloading/)).toBeNull()
  })

  it("shows the title's poster beside its row", async () => {
    renderPage(downloadsMain({ downloads: [DUNE] }))
    await screen.findByText('Dune (2021)')
    const picture = rowOf('Dune (2021)').querySelector('img')
    expect(picture?.getAttribute('src') ?? '').toContain('/api/pictures/items/4/poster/v1')
  })

  it('shows its first letter when the title has no poster', async () => {
    renderPage(downloadsMain({ downloads: [{ ...DUNE, artwork: { kind: 'none' } }] }))
    await screen.findByText('Dune (2021)')
    expect(rowOf('Dune (2021)').querySelector('img')).toBeNull()
    expect(within(rowOf('Dune (2021)')).getByText('D')).toBeInTheDocument()
  })

  it("shows an album's cover for audio", async () => {
    renderPage(
      downloadsMain({
        downloads: [{ ...DUNE, artwork: { kind: 'cover', albumId: 8, version: 'c1' } }],
      }),
    )
    await screen.findByText('Dune (2021)')
    const cover = rowOf('Dune (2021)').querySelector('img')
    expect(cover?.getAttribute('src') ?? '').toContain('/api/pictures/albums/8/c1')
  })
})

describe('DownloadsPage watch tab', () => {
  const LONG = viewOf({
    downloadId: DL_1,
    label: 'Arrival (2016)',
    group: { kind: DOWNLOAD_KINDS.movie, key: 'movie:1', title: 'Arrival (2016)', order: 0 },
    status: { kind: DOWNLOAD_STATUS_KINDS.ready },
    size: 9 * GB,
    facts: {
      year: 2016,
      score: 7.9,
      bitrate: 1,
      pixels: 1,
      addedAt: '2026-01-01T00:00:00.000Z',
      changedAt: '2026-01-01T00:00:00.000Z',
    },
  })
  const SMALL = {
    ...DUNE,
    size: GB,
    facts: { ...LONG.facts, year: 2021, score: 8.0, addedAt: '2026-06-01T00:00:00.000Z' },
  }

  const tilesIn = () =>
    within(screen.getByRole('list', { name: 'Downloads to watch' }))
      .getAllByRole('listitem')
      .map((tile) => tile.querySelector('span:not([aria-hidden])')?.textContent)

  it('switches to a grid of every download and back to the list', async () => {
    renderPage(downloadsMain({ downloads: [SMALL, EPISODE_2] }))
    await screen.findByText('Dune (2021)')
    expect(screen.getByRole('tab', { name: /Manage/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: /Watch/ }))
    const grid = screen.getByRole('list', { name: 'Downloads to watch' })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2)
    expect(within(grid).getByText('Severance')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Manage/ }))
    expect(screen.queryByRole('list', { name: 'Downloads to watch' })).toBeNull()
  })

  it('plays a ready tile and leaves one still downloading alone', async () => {
    const client = downloadsMain({
      downloads: [DUNE, EPISODE_2],
      answers: {
        openDownload: { type: DESKTOP_REPLIES.play, target: { fileId: FILE_ID, queue: [] } },
      },
    })
    renderPage(client)
    await userEvent.click(await screen.findByRole('tab', { name: /Watch/ }))
    expect(screen.queryByRole('button', { name: 'Play S01E02 Half Loop' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Play Dune (2021)' }))
    await waitFor(() => expect(where()).toBe(playPathOf(FILE_ID)))
  })

  it('sorts by title first and turns the order around', async () => {
    renderPage(downloadsMain({ downloads: [SMALL, LONG] }))
    await userEvent.click(await screen.findByRole('tab', { name: /Watch/ }))
    expect(tilesIn()).toEqual(['Arrival (2016)', 'Dune (2021)'])
    await userEvent.click(screen.getByRole('button', { name: /Order:/ }))
    expect(tilesIn()).toEqual(['Dune (2021)', 'Arrival (2016)'])
  })

  it('offers every field a library sorts on and sorts by each', async () => {
    renderPage(downloadsMain({ downloads: [SMALL, LONG] }))
    await userEvent.click(await screen.findByRole('tab', { name: /Watch/ }))
    const sort = screen.getByRole('combobox', { name: 'Sort' })
    expect(
      within(sort)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Title',
      'Date added',
      'Date changed',
      'File size',
      'Bitrate',
      'Resolution',
      'Release date',
      'Rating',
      'Random',
    ])
    await userEvent.selectOptions(sort, 'size')
    expect(tilesIn()).toEqual(['Arrival (2016)', 'Dune (2021)'])
    await userEvent.selectOptions(sort, 'added')
    expect(tilesIn()).toEqual(['Dune (2021)', 'Arrival (2016)'])
    await userEvent.selectOptions(sort, 'rating')
    expect(tilesIn()).toEqual(['Dune (2021)', 'Arrival (2016)'])
  })

  it('can shuffle, which has no direction to turn', async () => {
    renderPage(downloadsMain({ downloads: [SMALL, LONG] }))
    await userEvent.click(await screen.findByRole('tab', { name: /Watch/ }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'random')
    expect(screen.queryByRole('button', { name: /Order:/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeInTheDocument()
    expect(tilesIn()).toHaveLength(2)
  })

  it('says there is nothing to watch with no downloads', async () => {
    renderPage(downloadsMain())
    await userEvent.click(await screen.findByRole('tab', { name: /Watch/ }))
    expect(screen.getByText(/Nothing downloaded yet/)).toBeInTheDocument()
  })
})
