import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  AUDIO_BITRATES,
  type PlaylistDetails,
  type PlaylistInput,
  QUEUE_SOURCE_KINDS,
} from '@raven/core'
import type * as Native from '@raven/native'
import { RAVEN_SERVER } from '@raven/native/headless'
import { useAudioQueue } from '@raven/ui/headless'
import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library'
import { Dimensions } from 'react-native'

import {
  ALBUM_COPY,
  DETAIL_COPY,
  DOWNLOAD_BUTTON_COPY,
  KIT_COPY,
  NEW_PLAYLIST_COPY,
  PLAYER_COPY,
  TRACK_MENU_COPY,
} from '@raven/wren'
import {
  DOWNLOAD_SOURCES,
  DOWNLOAD_STATUSES,
  type DownloadEntry,
  downloadKeyOf,
  useDownloads,
} from '@/downloads/downloadStore'
import { queryClient } from '@/queryClient'
import { WREN_PAGES } from '@/routes'
import { useWrenAccount } from '@/session'
import { PHONE_WINDOW } from '@/test/jestSetup'
import {
  AIRBAG,
  LISTENER,
  MIXTAPE,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  RADIOHEAD,
  musicApi,
} from '@/test/music'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'

const ROAD_TRIP = { ...MIXTAPE, id: MIXTAPE.id + 10, name: 'Road trip', trackCount: 0, duration: 0 }

const mockApi = {
  ...musicApi(),
  createPlaylist: jest.fn(async (_input: PlaylistInput): Promise<PlaylistDetails> => ({
    playlist: ROAD_TRIP,
    tracks: [],
  })),
  artistPhotoUrl: (): string | null => null,
}
const playTracks = jest.fn<ReturnType<typeof useAudioQueue.getState>['playTracks']>()
const playNext = jest.fn<ReturnType<typeof useAudioQueue.getState>['playNext']>()
const addToQueue = jest.fn<ReturnType<typeof useAudioQueue.getState>['addToQueue']>()
const remove = jest.fn<ReturnType<typeof useDownloads.getState>['remove']>()

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

const ALBUM_URL = pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id })

const TABLET_WINDOW = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const

const mixtapeRow = TRACK_MENU_COPY.playlistRow({ name: MIXTAPE.name, count: '2 songs' })

/** OK Computer's tracks, all downloaded from its page. */
const downloadedEntries = () =>
  Object.fromEntries(
    OK_COMPUTER_PAGE.tracks.map((track): [string, DownloadEntry] => [
      downloadKeyOf({ serverId: RAVEN_SERVER.id, id: track.id }),
      {
        mediaId: track.id,
        serverId: RAVEN_SERVER.id,
        kbps: AUDIO_BITRATES.standard,
        bytes: 4_200_000,
        path: `downloads/${RAVEN_SERVER.id}/${track.id}/media.m4a`,
        coverPath: null,
        track,
        album: OK_COMPUTER,
        status: DOWNLOAD_STATUSES.done,
        queueStamp: 1,
      },
    ]),
  )

/** Opens Airbag's sheet from its More, then Add to playlist. */
const openAddToPlaylist = async () => {
  await fireEvent.press(await screen.findByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))
  await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.addToPlaylist }))
}

describe('Album', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.setState({ playTracks, playNext, addToQueue })
    useDownloads.setState({ entries: {}, playlists: {}, remove })
    remove.mockResolvedValue(undefined)
  })

  afterEach(() => {
    Dimensions.set({ window: PHONE_WINDOW, screen: PHONE_WINDOW })
  })

  it('lists the tracks under each disc in order, and plays the album from the top', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })

    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(screen.getByText('1997 · 3 songs · 15 min')).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Disc 1' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Disc 2' })).toBeTruthy()
    expect(
      screen.getAllByRole('button', { name: /^\d\. / }).map((row) => row.props.accessibilityLabel),
    ).toEqual(['1. Airbag', '2. Paranoid Android', '3. Lucky'])

    await fireEvent.press(screen.getByRole('button', { name: PLAYER_COPY.play }))
    expect(playTracks).toHaveBeenCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id },
    })
  })

  it('plays from the track pressed, and shuffles the album', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(await screen.findByRole('button', { name: '2. Paranoid Android' }))
    expect(playTracks).toHaveBeenCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      startAt: 1,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id },
    })

    await fireEvent.press(screen.getByRole('button', { name: PLAYER_COPY.shuffle }))
    expect(playTracks).toHaveBeenLastCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id },
      isShuffled: true,
    })
  })

  it('opens the artist from their name under the title', async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(
      await screen.findByRole('link', { name: ALBUM_COPY.openArtist(RADIOHEAD.name) }),
    )
    expect(await screen.findByRole('header', { name: RADIOHEAD.name })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id }))
  })

  it("puts a held row's track next or at the end of the queue from its sheet", async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    const airbag = await screen.findByRole('button', { name: '1. Airbag' })

    await fireEvent(airbag, 'longPress')
    expect(await screen.findByText(`${RADIOHEAD.name} · ${OK_COMPUTER.title}`)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: TRACK_MENU_COPY.playNext }))
    expect(playNext).toHaveBeenCalledWith([AIRBAG])

    await fireEvent(airbag, 'longPress')
    await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.addToQueue }))
    expect(addToQueue).toHaveBeenCalledWith([AIRBAG])
  })

  it("goes to a track's artist from its sheet", async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(await screen.findByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))
    await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.goToArtist }))
    expect(await screen.findByRole('header', { name: RADIOHEAD.name })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id }))
  })

  it('adds a track to a playlist, and says so in a toast', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await openAddToPlaylist()
    const sheet = await screen.findByLabelText(TRACK_MENU_COPY.pickPlaylist(AIRBAG.title))
    await fireEvent.press(await within(sheet).findByRole('button', { name: mixtapeRow }))

    expect(await screen.findByText(TRACK_MENU_COPY.added(MIXTAPE.name))).toBeTruthy()
    expect(mockApi.appendPlaylistTracks).toHaveBeenCalledWith({
      id: MIXTAPE.id,
      mediaIds: [AIRBAG.id],
    })
  })

  it('shows why adding a track to a playlist was refused', async () => {
    mockApi.appendPlaylistTracks.mockRejectedValueOnce(new Error('Playlist is full.'))
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await openAddToPlaylist()
    const sheet = await screen.findByLabelText(TRACK_MENU_COPY.pickPlaylist(AIRBAG.title))
    await fireEvent.press(await within(sheet).findByRole('button', { name: mixtapeRow }))

    expect(await screen.findByText('Playlist is full.')).toBeTruthy()
    expect(screen.queryByText(TRACK_MENU_COPY.added(MIXTAPE.name))).toBeNull()
  })

  it('makes a new playlist in the sheet and puts the track in it', async () => {
    mockApi.listPlaylists.mockResolvedValueOnce([])
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await openAddToPlaylist()
    expect(await screen.findByText(TRACK_MENU_COPY.noPlaylists)).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.title }))
    await fireEvent.changeText(await screen.findByLabelText(NEW_PLAYLIST_COPY.name), ROAD_TRIP.name)
    await fireEvent.press(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.create }))

    expect(await screen.findByText(TRACK_MENU_COPY.added(ROAD_TRIP.name))).toBeTruthy()
    expect(mockApi.createPlaylist).toHaveBeenCalledWith({ name: ROAD_TRIP.name })
    expect(mockApi.appendPlaylistTracks).toHaveBeenCalledWith({
      id: ROAD_TRIP.id,
      mediaIds: [AIRBAG.id],
    })
  })

  it("offers only the listener's own playlists, not another account's shared one", async () => {
    const theirs = {
      ...MIXTAPE,
      id: MIXTAPE.id + 1,
      name: 'Their mix',
      isShared: true,
      isOwn: false,
    }
    mockApi.listPlaylists.mockResolvedValueOnce([MIXTAPE, theirs])
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await openAddToPlaylist()
    const sheet = await screen.findByLabelText(TRACK_MENU_COPY.pickPlaylist(AIRBAG.title))
    expect(await within(sheet).findByRole('button', { name: mixtapeRow })).toBeTruthy()
    expect(within(sheet).queryByText(theirs.name)).toBeNull()
  })

  it('likes the album, and queues it', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(await screen.findByRole('switch', { name: PLAYER_COPY.like }))
    expect(mockApi.setAlbumFavourite).toHaveBeenCalledWith({
      albumId: OK_COMPUTER.id,
      favourite: true,
    })

    await fireEvent.press(screen.getByRole('button', { name: PLAYER_COPY.queue }))
    expect(addToQueue).toHaveBeenCalledWith(OK_COMPUTER_PAGE.tracks)
    expect(await screen.findByText(ALBUM_COPY.queued(OK_COMPUTER.title))).toBeTruthy()
  })

  it('plays the whole album next from its More sheet', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(await screen.findByRole('button', { name: DETAIL_COPY.more }))
    await fireEvent.press(await screen.findByRole('button', { name: TRACK_MENU_COPY.playNext }))
    expect(playNext).toHaveBeenCalledWith(OK_COMPUTER_PAGE.tracks)
  })

  it('marks each downloaded track, and offers Remove download once the album is all here', async () => {
    useDownloads.setState({ entries: downloadedEntries() })
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    const checks = (await screen.findAllByLabelText(KIT_COPY.downloaded)).filter(
      (check) => check.props.accessibilityRole === undefined,
    )
    expect(checks).toHaveLength(OK_COMPUTER_PAGE.tracks.length)

    await fireEvent.press(screen.getByRole('button', { name: DOWNLOAD_BUTTON_COPY.downloaded }))
    await fireEvent.press(await screen.findByRole('button', { name: DOWNLOAD_BUTTON_COPY.remove }))
    expect(remove).toHaveBeenCalledWith({
      serverId: RAVEN_SERVER.id,
      collection: { kind: DOWNLOAD_SOURCES.album, album: OK_COMPUTER },
    })
  })

  it('sets the head beside the tracklist on a tablet', async () => {
    Dimensions.set({ window: TABLET_WINDOW, screen: TABLET_WINDOW })
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(screen.getByRole('link', { name: KIT_COPY.backAlone })).toBeTruthy()
    expect(screen.getByRole('button', { name: DETAIL_COPY.more })).toBeTruthy()
    expect(screen.getByRole('button', { name: '1. Airbag' })).toBeTruthy()
  })

  it('says so when the album is not on the server', async () => {
    await renderRouter(WREN_TREE, {
      initialUrl: pagePathOf({ page: WREN_PAGES.album, id: 'not-a-number' }),
    })
    expect(await screen.findByText(ALBUM_COPY.missing)).toBeTruthy()
    expect(screen.getByRole('button', { name: KIT_COPY.backAlone })).toBeTruthy()
  })
})
