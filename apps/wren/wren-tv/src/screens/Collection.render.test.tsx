import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MUSIC_SORT_LABELS, MUSIC_SORTS, type PlaylistDetails, artistNames } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import {
  COVER_SIZES,
  KIT_COPY,
  LIBRARY_PAGE_COPY,
  LIBRARY_SEGMENTS,
  NEW_PLAYLIST_COPY,
  DEFAULT_SHARED_PREFS,
} from '@raven/wren'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@raven/wren-native'
import { WREN_PAGES, collectionPathOf } from '@raven/wren-native/headless'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { AIRBAG, LISTENER, MIXTAPE, OK_COMPUTER, RADIOHEAD, musicApi } from '@/test/music'
import type * as NativeMock from '@/test/nativeMock'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'

const ROAD_TRIP: PlaylistDetails = {
  playlist: { ...MIXTAPE, id: 12, name: 'Road trip', trackCount: 0, duration: 0 },
  tracks: [],
}

type CreateProps = { name: string }

const mockApi = {
  ...musicApi(),
  createPlaylist: jest.fn(async (_props: CreateProps): Promise<PlaylistDetails> => ROAD_TRIP),
}

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () =>
  jest.requireActual<typeof NativeMock>('@/test/nativeMock').nativeModuleMock({
    apiOf: () => mockApi,
  }),
)

const ALBUM_TILE = KIT_COPY.labelled({
  label: OK_COMPUTER.title,
  value: artistNames(OK_COMPUTER),
})

const open = (kind: (typeof LIBRARY_SEGMENTS)[keyof typeof LIBRARY_SEGMENTS]) =>
  renderRouter(WREN_TREE, { initialUrl: collectionPathOf(kind) })

describe('Collection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useAudioQueue.getState().clear()
    useWrenAccount.setState({ session: LISTENER })
    useWrenPrefs.setState(DEFAULT_SHARED_PREFS)
  })

  it('lists the albums as tiles that open their page', async () => {
    const router = await open(LIBRARY_SEGMENTS.albums)
    expect(await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.albums })).toBeTruthy()
    await fireEvent.press(await screen.findByRole('button', { name: ALBUM_TILE }))
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id }))
  })

  it('opens Albums for Downloads, which a TV has none of', async () => {
    await open(LIBRARY_SEGMENTS.downloads)
    expect(await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.albums })).toBeTruthy()
  })

  it("keeps the cover size picked from Albums' sheet", async () => {
    await open(LIBRARY_SEGMENTS.albums)
    await fireEvent.press(
      await screen.findByRole('button', {
        name: LIBRARY_PAGE_COPY.coverSizeLabel(LIBRARY_PAGE_COPY.coverSizes[COVER_SIZES.medium]),
      }),
    )
    await fireEvent.press(
      await screen.findByRole('radio', { name: LIBRARY_PAGE_COPY.coverSizes[COVER_SIZES.large] }),
    )
    expect(useWrenPrefs.getState().coverSize).toBe(COVER_SIZES.large)
  })

  it("offers raven's sorts from the sort button", async () => {
    await open(LIBRARY_SEGMENTS.albums)
    await fireEvent.press(
      await screen.findByRole('button', {
        name: LIBRARY_PAGE_COPY.sortLabel(MUSIC_SORT_LABELS[MUSIC_SORTS.title]),
      }),
    )
    await fireEvent.press(
      await screen.findByRole('radio', { name: MUSIC_SORT_LABELS[MUSIC_SORTS.year] }),
    )
    expect(
      await screen.findByRole('button', {
        name: LIBRARY_PAGE_COPY.sortLabel(MUSIC_SORT_LABELS[MUSIC_SORTS.year]),
      }),
    ).toBeTruthy()
  })

  it('lists the artists as tiles that open their page', async () => {
    const router = await open(LIBRARY_SEGMENTS.artists)
    await fireEvent.press(
      await screen.findByRole('button', { name: new RegExp(`^${RADIOHEAD.name}`) }),
    )
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id }))
  })

  it('plays the songs from the row pressed', async () => {
    await open(LIBRARY_SEGMENTS.songs)
    await fireEvent.press(await screen.findByRole('button', { name: AIRBAG.title }))
    expect(playingTrackOf(useAudioQueue.getState())?.id).toBe(AIRBAG.id)
  })

  it('makes a playlist from New playlist and opens it', async () => {
    const router = await open(LIBRARY_SEGMENTS.playlists)
    expect(await screen.findByRole('button', { name: new RegExp(`^${MIXTAPE.name}`) })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.title }))
    await fireEvent.changeText(
      await screen.findByLabelText(NEW_PLAYLIST_COPY.name),
      ROAD_TRIP.playlist.name,
    )
    await fireEvent.press(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.create }))
    expect(mockApi.createPlaylist).toHaveBeenCalled()
    expect(router.getPathname()).toBe(
      pagePathOf({ page: WREN_PAGES.playlist, id: ROAD_TRIP.playlist.id }),
    )
  })
})
