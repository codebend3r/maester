import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { AUDIO_BITRATES, QUEUE_SOURCE_KINDS } from '@raven/core'
import type * as Native from '@raven/native'
import { RAVEN_SERVER } from '@raven/native/headless'
import { useAudioQueue } from '@raven/ui/headless'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import {
  DOWNLOAD_COPY,
  DOWNLOAD_SOURCES,
  DOWNLOAD_STATUSES,
  type DownloadEntry,
  useDownloads,
} from '@/downloads/downloadStore'
import { queryClient } from '@/queryClient'
import { WREN_ROUTES } from '@/routes'
import { useWrenAccount } from '@/session'
import { DEFAULT_WREN_PREFS, useWrenPrefs } from '@/stores/wrenPrefs'
import {
  AIRBAG,
  LISTENER,
  MIXTAPE,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  PARANOID,
  musicApi,
} from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()
const playTracks = jest.fn<ReturnType<typeof useAudioQueue.getState>['playTracks']>()
const downloadTracks = jest.fn<ReturnType<typeof useDownloads.getState>['downloadTracks']>()
const remove = jest.fn<ReturnType<typeof useDownloads.getState>['remove']>()
const removeAll = jest.fn<ReturnType<typeof useDownloads.getState>['removeAll']>()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

type EntryForProps = { track: typeof AIRBAG; album: typeof OK_COMPUTER | null }

const entryFor = ({ track, album }: EntryForProps): DownloadEntry => ({
  mediaId: track.id,
  serverId: RAVEN_SERVER.id,
  kbps: AUDIO_BITRATES.standard,
  bytes: 4_200_000,
  path: `downloads/${RAVEN_SERVER.id}/${track.id}/media.m4a`,
  track,
  album,
  status: DOWNLOAD_STATUSES.done,
})

/** OK Computer's first two tracks downloaded from its page, and Airbag again in the Mixtape. */
const DOWNLOADED = {
  entries: {
    [AIRBAG.id]: entryFor({ track: AIRBAG, album: OK_COMPUTER }),
    [PARANOID.id]: entryFor({ track: PARANOID, album: OK_COMPUTER }),
  },
  playlists: {
    [MIXTAPE.id]: { serverId: RAVEN_SERVER.id, playlist: MIXTAPE, mediaIds: [AIRBAG.id] },
  },
}

describe('Downloads', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    useAudioQueue.setState({ playTracks })
    downloadTracks.mockResolvedValue(null)
    remove.mockResolvedValue(undefined)
    removeAll.mockResolvedValue(undefined)
    useDownloads.setState({ entries: {}, playlists: {}, downloadTracks, remove, removeAll })
  })

  it("downloads an album from its page, and says the storage limit's refusal", async () => {
    await renderRouter(WREN_TREE, { initialUrl: `/album/${OK_COMPUTER.id}` })
    await fireEvent.press(await screen.findByRole('button', { name: 'Download' }))
    expect(downloadTracks).toHaveBeenCalledWith({
      serverId: RAVEN_SERVER.id,
      tracks: OK_COMPUTER_PAGE.tracks,
      collection: { kind: DOWNLOAD_SOURCES.album, album: OK_COMPUTER },
    })

    downloadTracks.mockResolvedValue(DOWNLOAD_COPY.full(2))
    await fireEvent.press(screen.getByRole('button', { name: 'Download' }))
    expect(await screen.findByText(DOWNLOAD_COPY.full(2))).toBeTruthy()
  })

  it("says how far an album has come, and removes it once it's all downloaded", async () => {
    useDownloads.setState({
      entries: {
        ...DOWNLOADED.entries,
        [OK_COMPUTER_PAGE.tracks[2]?.id ?? 0]: {
          ...entryFor({ track: OK_COMPUTER_PAGE.tracks[2] ?? AIRBAG, album: OK_COMPUTER }),
          status: DOWNLOAD_STATUSES.downloading,
        },
      },
    })
    await renderRouter(WREN_TREE, { initialUrl: `/album/${OK_COMPUTER.id}` })
    expect(await screen.findByRole('button', { name: 'Downloading 2 of 3' })).toBeTruthy()

    useDownloads.setState({
      entries: Object.fromEntries(
        OK_COMPUTER_PAGE.tracks.map((track) => [track.id, entryFor({ track, album: OK_COMPUTER })]),
      ),
    })
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove download' }))
    expect(remove).toHaveBeenCalledWith({ mediaIds: OK_COMPUTER_PAGE.tracks.map(({ id }) => id) })
  })

  it("lists what is downloaded under Library's Downloads and plays it, with the server out of reach", async () => {
    mockApi.listLibraries.mockRejectedValue(new Error("raven can't be reached."))
    useDownloads.setState(DOWNLOADED)
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    await fireEvent.press(await screen.findByRole('tab', { name: 'Downloads' }))

    await fireEvent.press(await screen.findByRole('button', { name: OK_COMPUTER.title }))
    expect(playTracks).toHaveBeenCalledWith({
      tracks: [AIRBAG, PARANOID],
      source: { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id },
    })
    await fireEvent.press(screen.getByRole('button', { name: MIXTAPE.name }))
    expect(playTracks).toHaveBeenLastCalledWith({
      tracks: [AIRBAG],
      source: { kind: QUEUE_SOURCE_KINDS.playlist, id: MIXTAPE.id },
    })
  })

  it('says when nothing is downloaded', async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    await fireEvent.press(await screen.findByRole('tab', { name: 'Downloads' }))
    expect(
      await screen.findByText(
        'Nothing downloaded yet. Download an album or a playlist from its page.',
      ),
    ).toBeTruthy()
  })

  it("sets Settings' download quality, cellular quality and storage limit, and removes them all", async () => {
    useDownloads.setState(DOWNLOADED)
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.settings })
    expect(await screen.findByText('Download quality')).toBeTruthy()
    expect(screen.getByText('8.4 MB used by downloads')).toBeTruthy()

    const [downloadHigh, cellularHigh] = screen.getAllByRole('tab', { name: '320 kbps' })
    await fireEvent.press(downloadHigh)
    expect(useWrenPrefs.getState().downloadKbps).toBe(AUDIO_BITRATES.high)
    expect(cellularHigh).toBeTruthy()
    await fireEvent.press(screen.getByRole('tab', { name: 'Original' }))
    expect(useWrenPrefs.getState().cellularKbps).toBeNull()
    await fireEvent.press(screen.getByRole('tab', { name: '5 GB' }))
    expect(useWrenPrefs.getState().storageLimitGb).toBe(5)

    await fireEvent.press(screen.getByRole('button', { name: 'Remove all downloads' }))
    expect(removeAll).toHaveBeenCalled()
  })
})
